import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import { PAYROLL_COUNTRIES, hasPack, packFor } from '@skoolos/types';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { ApiError } from '../../../common/errors/api-error';
import { AuditService } from '../../../common/audit/audit.service';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { TenantContextService } from '../../tenancy';
import { SalaryGuard } from './salary.guard';
import { PayPackService } from './pay-pack.service';
import { PayPeopleService } from './pay-people.service';
import { PayRunService } from './pay-run.service';
import { PayStatutoryService } from './pay-statutory.service';
import {
  AdjustmentDto, GrantSalaryDto, OpenRunDto, PreviewStructureDto,
  SchoolPayCountryDto, SetStructureDto, UpsertComponentDto,
} from './payroll.dto';

/**
 * SALARY — the admin console's side.
 *
 * Four guards, in order: a school session, the SALARY module switched on for
 * this school, the SCHOOL_ADMIN role, and finally the per-admin salary right.
 * The last one is the point: everywhere else in the console "admin" is the
 * whole answer, and for pay it is not.
 */
@Controller('payroll')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard, SalaryGuard)
@RequireFeature('SALARY')
@Roles('SCHOOL_ADMIN')
export class PayrollController {
  constructor(
    private readonly packs: PayPackService,
    private readonly people: PayPeopleService,
    private readonly runs: PayRunService,
    private readonly statutory: PayStatutoryService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  /** The rule book this school is on, and when we last checked it. */
  @Get('settings')
  async settings(@CurrentUser() u: SchoolJwtPayload) {
    const s = await this.packs.forSchool(this.sid());
    await this.audit.record({ schoolId: this.sid(), actorUserId: u.sub, action: 'salary.open', entity: 'PayRun' });
    return {
      countryCode: s.countryCode, currency: s.currency, region: s.region,
      taxYearStartMonth: s.taxYearStartMonth,
      pack: {
        label: s.pack.label, version: s.pack.version, rulesAsAt: s.pack.rulesAsAt,
        regionLabel: s.pack.regionLabel, regions: s.pack.regions,
        regimes: s.pack.regimes.map((r) => ({ key: r.key, label: r.label, allows: r.allows })),
        defaultRegime: s.pack.defaultRegime,
        payDueDay: s.pack.payDueDay, fnfWorkingDays: s.pack.fnfWorkingDays,
        unverified: s.pack.unverified,
      },
      countries: PAYROLL_COUNTRIES,
    };
  }

  /**
   * The school's country and state. Frozen once a run is locked, because
   * changing it would invalidate every figure already filed.
   */
  @Post('settings')
  async setCountry(@CurrentUser() u: SchoolJwtPayload, @Body() dto: SchoolPayCountryDto) {
    const schoolId = this.sid();
    if (!hasPack(dto.countryCode)) {
      throw new ApiError('SALARY_NO_PACK', `Salary has no rule book for ${dto.countryCode} yet.`, 400, 'countryCode');
    }
    const locked = await withTenant(schoolId, (tx) =>
      tx.payRun.count({ where: { schoolId, status: { in: ['LOCKED', 'PAID'] } } }),
    );
    if (locked > 0) {
      throw new ApiError('PAY_RUN_LOCKED', 'Pay has already been locked for this school, so the country cannot change. Talk to us first.', 409, 'countryCode');
    }
    const pack = packFor(dto.countryCode);
    await getPlatformPrisma().school.update({
      where: { id: schoolId },
      data: {
        countryCode: dto.countryCode,
        region: dto.region ?? null,
        currency: dto.currency ?? pack.currency,
        taxYearStartMonth: pack.taxYearStartMonth,
      },
    });
    await this.audit.record({ schoolId, actorUserId: u.sub, action: 'salary.country', entity: 'School', entityId: schoolId, meta: { ...dto } });
    return { ok: true };
  }

  // ── People ────────────────────────────────────────────────
  @Get('components')
  components() { return this.people.components(this.sid()); }

  @Post('components')
  component(@Body() dto: UpsertComponentDto) { return this.people.upsertComponent(this.sid(), dto); }

  @Get('people')
  peopleList(@Query('on') on?: string) {
    return this.people.people(this.sid(), on ?? new Date().toISOString().slice(0, 10));
  }

  @Get('people/:kind/:id')
  history(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.people.history(this.sid(), kindOf(kind), id);
  }

  @Post('people/preview')
  preview(@Body() dto: PreviewStructureDto) {
    return this.people.preview(this.sid(), {
      monthlyGrossMinor: dto.monthlyGrossMinor,
      fixedAmounts: dto.fixedAmounts,
      onISO: dto.onISO ?? new Date().toISOString().slice(0, 10),
    });
  }

  @Post('people/structure')
  async structure(@CurrentUser() u: SchoolJwtPayload, @Body() dto: SetStructureDto) {
    const r = await this.people.setStructure(this.sid(), u.sub, dto);
    await this.audit.record({
      schoolId: this.sid(), actorUserId: u.sub, action: 'salary.structure', entity: 'EmployeePay', entityId: r.id,
      meta: { personKind: dto.personKind, personId: dto.personId, effectiveFrom: dto.effectiveFrom, monthlyGrossMinor: dto.monthlyGrossMinor },
    });
    return r;
  }

  // ── Who may see salary ────────────────────────────────────
  @Get('access')
  async access() {
    const schoolId = this.sid();
    const admins = await getPlatformPrisma().user.findMany({
      where: { schoolId, role: 'SCHOOL_ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, canSeeSalary: true, createdAt: true },
      take: LIST_CEILING.STRUCTURE,
    });
    return admins;
  }

  @Post('access')
  async grant(@CurrentUser() u: SchoolJwtPayload, @Body() dto: GrantSalaryDto) {
    const schoolId = this.sid();
    if (dto.userId === u.sub && !dto.canSeeSalary) {
      throw new ApiError('VALIDATION', 'You cannot take the salary right away from yourself — ask another admin who has it.', 400, 'userId');
    }
    const target = await getPlatformPrisma().user.findFirst({
      where: { id: dto.userId, schoolId, role: 'SCHOOL_ADMIN' }, select: { id: true },
    });
    if (!target) throw new ApiError('NOT_FOUND', 'That admin is not at this school.', 404, 'userId');
    await getPlatformPrisma().user.update({ where: { id: dto.userId }, data: { canSeeSalary: dto.canSeeSalary } });
    await this.audit.record({
      schoolId, actorUserId: u.sub, action: dto.canSeeSalary ? 'salary.grant' : 'salary.revoke',
      entity: 'User', entityId: dto.userId,
    });
    return { ok: true };
  }

  // ── The run ───────────────────────────────────────────────
  @Get('runs')
  runsList() { return this.runs.list(this.sid()); }

  @Post('runs')
  open(@CurrentUser() u: SchoolJwtPayload, @Body() dto: OpenRunDto) {
    return this.runs.open(this.sid(), u.sub, dto.year, dto.month);
  }

  @Get('runs/:id')
  run(@Param('id', ParseUUIDPipe) id: string) { return this.runs.detail(this.sid(), id); }

  @Post('runs/:id/calculate')
  async calculate(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.runs.calculate(this.sid(), id);
    await this.audit.record({ schoolId: this.sid(), actorUserId: u.sub, action: 'salary.calculate', entity: 'PayRun', entityId: id, meta: { headcount: r.headcount, netMinor: r.netMinor } });
    return r;
  }

  @Post('runs/:id/approve')
  async approve(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.runs.approve(this.sid(), u.sub, id);
    await this.audit.record({ schoolId: this.sid(), actorUserId: u.sub, action: 'salary.approve', entity: 'PayRun', entityId: id });
    return r;
  }

  @Post('runs/:id/lock')
  async lock(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.runs.lock(this.sid(), u.sub, id);
    await this.audit.record({ schoolId: this.sid(), actorUserId: u.sub, action: 'salary.lock', entity: 'PayRun', entityId: id });
    return r;
  }

  @Post('runs/:id/paid')
  async paid(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.runs.markPaid(this.sid(), id);
    await this.audit.record({ schoolId: this.sid(), actorUserId: u.sub, action: 'salary.paid', entity: 'PayRun', entityId: id });
    return r;
  }

  // ── Adjustments: arrears, one-offs, unpaid days ───────────
  @Post('adjustments')
  async adjust(@CurrentUser() u: SchoolJwtPayload, @Body() dto: AdjustmentDto) {
    const schoolId = this.sid();
    return withTenant(schoolId, async (tx) => {
      const locked = await tx.payRun.findFirst({
        where: { schoolId, periodYear: dto.periodYear, periodMonth: dto.periodMonth, status: { in: ['LOCKED', 'PAID'] } },
        select: { id: true },
      });
      if (locked) {
        throw new ApiError('PAY_RUN_LOCKED', 'That month is locked. Put the correction in the next month instead.', 409, 'periodMonth');
      }
      const row = await tx.payAdjustment.create({
        data: {
          schoolId, personKind: dto.personKind,
          teacherId: dto.personKind === 'TEACHER' ? dto.personId : null,
          staffId: dto.personKind === 'STAFF' ? dto.personId : null,
          periodYear: dto.periodYear, periodMonth: dto.periodMonth,
          label: dto.label, kind: dto.kind, amountMinor: dto.amountMinor,
          taxable: dto.taxable ?? true, lopDays: dto.lopDays ?? 0, note: dto.note ?? null,
          createdById: u.sub,
        },
        select: { id: true },
      });
      await this.audit.record({ schoolId, actorUserId: u.sub, action: 'salary.adjust', entity: 'PayAdjustment', entityId: row.id, meta: { ...dto } });
      return row;
    });
  }

  @Get('adjustments')
  adjustments(@Query('year') year: string, @Query('month') month: string) {
    const schoolId = this.sid();
    return withTenant(schoolId, (tx) =>
      tx.payAdjustment.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: { schoolId, periodYear: Number(year), periodMonth: Number(month) },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  // ── Statutory ─────────────────────────────────────────────
  @Get('statutory/calendar')
  calendar(@Query('year') year: string, @Query('month') month: string) {
    return this.statutory.calendar(this.sid(), Number(year), Number(month));
  }

  @Get('runs/:id/files/:what')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('what') what: string) {
    const schoolId = this.sid();
    switch (what) {
      case 'pf': return this.statutory.retirementFile(schoolId, id);
      case 'esi': return this.statutory.healthFile(schoolId, id);
      case 'bank': return this.statutory.bankFile(schoolId, id);
      case 'register': return this.statutory.registerFile(schoolId, id);
      default: throw new ApiError('VALIDATION', 'No such file.', 400, 'what');
    }
  }

  @Get('statement/:kind/:id')
  statement(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Query('taxYear') taxYear: string) {
    return this.statutory.annualStatement(this.sid(), kindOf(kind), id, Number(taxYear));
  }
}

function kindOf(raw: string): 'TEACHER' | 'STAFF' {
  const k = raw.toUpperCase();
  if (k !== 'TEACHER' && k !== 'STAFF') throw new ApiError('VALIDATION', 'kind must be teacher or staff.', 400, 'kind');
  return k;
}
