import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { UserRole, withTenant, Prisma } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import { ConvertDto, CreateLeadDto, DecisionDto, StageDto, UpdateLeadDto } from './admissions.dto';

/**
 * Admissions CRM: Lead → AdmissionApplication → User+StudentProfile+Enrollment.
 *
 * Conversion on ACCEPTED is the value-bearing path:
 *   1. Extract first/lastName + (optional) email from applicantData.
 *   2. Create a User(STUDENT) row with placeholder password (consumed later
 *      via the same `/auth/accept-invite` flow as admin onboarding).
 *   3. Create StudentProfile.
 *   4. Optional auto-enrollment if classId+academicYearId given.
 *
 * If the email is already taken in this school, we surface a 409 — admin
 * can fix the email and re-decision.
 */
@ApiTags('admissions')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller()
export class AdmissionsController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  // ── Leads ─────────────────────────────────────────────────────────────────
  @Get('leads')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async listLeads(@Query('stage') stage?: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.lead.findMany({
        where: stage ? { stage: stage as Prisma.EnumLeadStageFilter['equals'] } : undefined,
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }

  @Post('leads')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async createLead(@Body() dto: CreateLeadDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.lead.create({ data: { schoolId, ...dto, stage: 'NEW' } }),
    );
  }

  @Patch('leads/:id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async updateLead(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) =>
        tx.lead.update({
          where: { id },
          data: {
            fullName: dto.fullName,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            gradeAppliedFor: dto.gradeAppliedFor,
            notes: dto.notes,
            assignedToUserId: dto.assignedToUserId,
            nextActionAt: dto.nextActionAt ? new Date(dto.nextActionAt) : undefined,
          },
        }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException();
      throw e;
    }
  }

  @Patch('leads/:id/stage')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async setStage(@Param('id') id: string, @Body() dto: StageDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) =>
        tx.lead.update({ where: { id }, data: { stage: dto.stage } }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException();
      throw e;
    }
  }

  @Delete('leads/:id')
  @Roles(UserRole.SCHOOL_ADMIN)
  async removeLead(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    await withTenant(schoolId, (tx) => tx.lead.delete({ where: { id } })).catch(() => undefined);
    return { ok: true };
  }

  @Post('leads/:id/convert')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async convert(@Param('id') id: string, @Body() dto: ConvertDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id } });
      if (!lead) throw new NotFoundException();
      const app = await tx.admissionApplication.create({
        data: {
          schoolId,
          leadId: id,
          applicantData: dto.applicantData as Prisma.InputJsonValue,
          status: 'SUBMITTED',
        },
      });
      await tx.lead.update({ where: { id }, data: { stage: 'APPLIED' } });
      return app;
    });
  }

  // ── Applications ──────────────────────────────────────────────────────────
  @Get('applications')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async listApps(@Query('status') status?: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.admissionApplication.findMany({
        where: status ? { status: status as Prisma.EnumApplicationStatusFilter['equals'] } : undefined,
        include: { lead: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  @Get('applications/:id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF)
  async oneApp(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const row = await withTenant(schoolId, (tx) =>
      tx.admissionApplication.findUnique({ where: { id }, include: { lead: true } }),
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  @Patch('applications/:id/decision')
  @Roles(UserRole.SCHOOL_ADMIN)
  async decide(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser() owner: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const app = await tx.admissionApplication.findUnique({ where: { id } });
      if (!app) throw new NotFoundException();

      const updated = await tx.admissionApplication.update({
        where: { id },
        data: {
          status: dto.status,
          reviewerUserId: owner.sub,
          decidedAt: ['ACCEPTED', 'REJECTED'].includes(dto.status) ? new Date() : null,
        },
      });

      if (dto.status === 'ACCEPTED') {
        const data = app.applicantData as Record<string, unknown>;
        const firstName = typeof data.firstName === 'string' ? data.firstName : 'New';
        const lastName = typeof data.lastName === 'string' ? data.lastName : 'Student';
        const email =
          typeof data.email === 'string'
            ? data.email.toLowerCase()
            : `student.${randomBytes(4).toString('hex')}@${schoolId}.invalid`;
        // Placeholder hash = hash(invite token) so the student can accept via /auth/accept-invite.
        const inviteToken = randomBytes(24).toString('hex');
        const passwordHash = await argon2.hash(inviteToken, { type: argon2.argon2id });

        let user;
        try {
          user = await tx.user.create({
            data: {
              schoolId,
              email,
              role: 'STUDENT',
              firstName,
              lastName,
              passwordHash,
              isActive: true,
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new BadRequestException(`A user with email ${email} already exists in this school`);
          }
          throw e;
        }
        await tx.studentProfile.create({ data: { schoolId, userId: user.id } });

        // Auto-enroll if the decision body included class/section/year info.
        if (dto.classId && dto.academicYearId) {
          await tx.enrollment.create({
            data: {
              schoolId,
              studentUserId: user.id,
              classId: dto.classId,
              sectionId: dto.sectionId,
              academicYearId: dto.academicYearId,
              status: 'ACTIVE',
            },
          });
        }
        if (app.leadId) {
          await tx.lead.update({ where: { id: app.leadId }, data: { stage: 'ENROLLED' } });
        }

        return { application: updated, createdUser: { id: user.id, email: user.email }, inviteToken };
      }
      return { application: updated };
    });
  }
}
