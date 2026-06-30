import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, UserRole, withTenant, getPlatformPrisma } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import {
  AssignFeePlanDto,
  CreateFeeStructureDto,
  GenerateInvoicesDto,
  RecordPaymentDto,
} from './finance.dto';

/**
 * Finance — fee structures → assignments → invoices → payments.
 *
 * Invoice numbering uses a per-school monotonic sequence: we read the
 * current max(number) for the school and take +1, all inside the same
 * tenant-scoped transaction (RLS guarantees no other tenant is touching it).
 * Two concurrent generators could collide on the unique (schoolId, number)
 * index → first commits, second gets a P2002 → caller retries.
 */
@ApiTags('finance')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller()
export class FeesController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  // ── Fee structures ────────────────────────────────────────────────────
  @Get('fee-structures')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async listStructures() {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.feeStructure.findMany({
        include: { items: true, _count: { select: { assignments: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  @Post('fee-structures')
  @Roles(UserRole.SCHOOL_ADMIN)
  async createStructure(@Body() dto: CreateFeeStructureDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const total = dto.items.reduce((s, i) => s + i.amount, 0);
    return withTenant(schoolId, async (tx) => {
      const ay = await tx.academicYear.findUnique({ where: { id: dto.academicYearId } });
      if (!ay) throw new BadRequestException('academicYearId not in this school');
      return tx.feeStructure.create({
        data: {
          schoolId,
          name: dto.name,
          academicYearId: dto.academicYearId,
          currency: dto.currency,
          totalAmount: total,
          items: {
            create: dto.items.map((i) => ({
              schoolId,
              label: i.label,
              amount: i.amount,
              dueDate: new Date(i.dueDate),
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  // ── Plan assignments ──────────────────────────────────────────────────
  @Post('fee-structures/:id/assign')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async assign(@Param('id') id: string, @Body() dto: AssignFeePlanDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const fs = await tx.feeStructure.findUnique({ where: { id } });
      if (!fs) throw new NotFoundException();
      const inserted = await Promise.all(
        dto.studentUserIds.map((studentUserId) =>
          tx.feePlanAssignment
            .create({ data: { schoolId, feeStructureId: id, studentUserId } })
            .catch((e: unknown) => {
              if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
              throw e;
            }),
        ),
      );
      return { assigned: inserted.filter(Boolean).length };
    });
  }

  // ── Invoice batch generation ──────────────────────────────────────────
  @Post('invoices/generate')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async generate(@Body() dto: GenerateInvoicesDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const fs = await tx.feeStructure.findUnique({
        where: { id: dto.feeStructureId },
        include: { assignments: true, items: true },
      });
      if (!fs) throw new NotFoundException();
      const last = await tx.invoice.aggregate({ where: { schoolId }, _max: { number: true } });
      let next = (last._max.number ?? 0) + 1;
      const earliestDue = fs.items.reduce<Date>((min, i) => (i.dueDate < min ? i.dueDate : min), fs.items[0]?.dueDate ?? new Date());
      const out = [];
      for (const a of fs.assignments) {
        const inv = await tx.invoice.create({
          data: {
            schoolId,
            number: next++,
            feePlanAssignmentId: a.id,
            studentUserId: a.studentUserId,
            amountDue: fs.totalAmount,
            currency: fs.currency,
            status: 'OPEN',
            dueDate: earliestDue,
            metadata: { feeStructureId: fs.id, feeStructureName: fs.name },
          },
        });
        out.push(inv);
      }
      return { created: out.length, invoiceIds: out.map((i) => i.id) };
    });
  }

  // ── Invoices ───────────────────────────────────────────────────────────
  @Get('invoices')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF, UserRole.STUDENT, UserRole.PARENT)
  async listInvoices(
    @Query('status') status?: string,
    @Query('studentUserId') studentUserId?: string,
  ) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.invoice.findMany({
        where: {
          ...(status ? { status: status as Prisma.EnumInvoiceStatusFilter['equals'] } : {}),
          ...(studentUserId ? { studentUserId } : {}),
        },
        orderBy: { issuedAt: 'desc' },
      }),
    );
  }

  @Get('invoices/:id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF, UserRole.STUDENT, UserRole.PARENT)
  async oneInvoice(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const row = await withTenant(schoolId, (tx) =>
      tx.invoice.findUnique({
        where: { id },
        include: { payments: true, discounts: true, feePlanAssignment: { include: { feeStructure: { include: { items: true } } } } },
      }),
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  // ── Payments (manual record — card flow goes through Stripe controller) ──
  @Post('invoices/:id/payments')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    if (dto.method === 'CARD') {
      throw new BadRequestException('Use /invoices/:id/checkout for card payments.');
    }
    return withTenant(schoolId, async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException();
      const payment = await tx.payment.create({
        data: { schoolId, invoiceId: id, amount: dto.amount, method: dto.method },
      });
      // Recompute paid/status
      const totalPaid = Number(inv.amountPaid) + dto.amount;
      const due = Number(inv.amountDue);
      const status = totalPaid >= due ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'OPEN';
      const updated = await tx.invoice.update({
        where: { id },
        data: { amountPaid: totalPaid, status },
      });
      return { payment, invoice: updated };
    });
  }
}

/**
 * Read-side helper: surface a tenant's own school usage from the *platform*
 * Prisma so platform admins can do tenant-aware reporting without changing
 * tenant context. Not yet exposed via an endpoint; kept for Phase-7 use.
 */
export async function _platformInvoiceAggregate(schoolId: string) {
  return getPlatformPrisma().invoice.groupBy({
    by: ['status'],
    where: { schoolId },
    _sum: { amountDue: true, amountPaid: true },
  });
}
