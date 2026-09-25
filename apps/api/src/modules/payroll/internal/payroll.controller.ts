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
import { PayGradesService } from './pay-grades.service';
import { PayLeaveService } from './pay-leave.service';
import { PayOverviewService } from './pay-overview.service';
import { PayPeopleService } from './pay-people.service';
import { PayRunService } from './pay-run.service';
import { PayStatutoryService } from './pay-statutory.service';
import { PayslipDocService } from './payslip-doc.service';
import {
  AdjustmentDto, ApplyLeaveLopDto, AssignGradeDto, GrantSalaryDto, LopPolicyDto, OpenRunDto, PayDetailsDto,
  PreviewGradeDto, PreviewStructureDto, RaiseGradeDto, SchoolPayCountryDto, SetStructureDto,
  UpsertComponentDto, UpsertGradeDto,
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
// STAFF is admitted only so `SalaryGuard` can ask what their JOB is — it
// refuses every staff member who is not the accounts officer, and then still
// requires the per-person salary right. RolesGuard cannot express "a staff
// member whose Staff.role is ACCOUNTS"; the guard after it can.
@Roles('SCHOOL_ADMIN', 'STAFF')
export class PayrollController {
  constructor(
    private readonly packs: PayPackService,
    private readonly people: PayPeopleService,
    private readonly grades: PayGradesService,
    private readonly leave: PayLeaveService,
    private readonly overviews: PayOverviewService,
    private readonly runs: PayRunService,
    private readonly statutory: PayStatutoryService,
    private readonly payslipDocs: PayslipDocService,
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

  // ── The home screen ───────────────────────────────────────
  /**
   * Where the school is in the month, and what needs a person.
   *
   * One call for one question. The month defaults to the one a school would
   * actually be running — today's — so the screen never has to ask which.
   */
  @Get('overview')
  overview(@Query('year') year?: string, @Query('month') month?: string) {
    const now = new Date();
    const y = Number(year) || now.getUTCFullYear();
    const m = Number(month) || now.getUTCMonth() + 1;
    if (y < 2000 || y > 2100 || m < 1 || m > 12) {
      throw new ApiError('VALIDATION', 'That is not a month we can run.', 400, 'month');
    }
    return this.overviews.overview(this.sid(), y, m);
  }

  // ── Leave that reaches pay ────────────────────────────────
  /**
   * What this month's approved leave would cost, per person, with the
   * arithmetic for each. It PROPOSES; `leave/apply` is what writes.
   */
  @Get('leave')
  leaveMonth(@Query('year') year?: string, @Query('month') month?: string) {
    const now = new Date();
    return this.leave.month(this.sid(), Number(year) || now.getUTCFullYear(), Number(month) || now.getUTCMonth() + 1);
  }

  @Post('leave/apply')
  async applyLeave(@CurrentUser() u: SchoolJwtPayload, @Body() dto: ApplyLeaveLopDto) {
    const r = await this.leave.apply(this.sid(), u.sub, dto.year, dto.month, dto.personIds);
    await this.audit.record({
      schoolId: this.sid(), actorUserId: u.sub, action: 'salary.leave.apply', entity: 'PayAdjustment',
      meta: { year: dto.year, month: dto.month, people: dto.personIds.length, applied: r.applied },
    });
    return r;
  }

  /** The school's one deduction rule. */
  @Post('leave/policy')
  async setLopPolicy(@CurrentUser() u: SchoolJwtPayload, @Body() dto: LopPolicyDto) {
    const schoolId = this.sid();
    await getPlatformPrisma().school.update({
      where: { id: schoolId },
      data: { lopBasis: dto.basis, ...(dto.countHalfDays === undefined ? {} : { lopCountsHalfDays: dto.countHalfDays }) },
    });
    await this.audit.record({
      schoolId, actorUserId: u.sub, action: 'salary.leave.policy', entity: 'School', entityId: schoolId,
      meta: { basis: dto.basis, countHalfDays: dto.countHalfDays ?? null },
    });
    return { ok: true };
  }

  // ── Grades ────────────────────────────────────────────────
  @Get('grades')
  gradeList(@Query('on') on?: string) {
    return this.grades.list(this.sid(), on ?? today());
  }

  /** Grades drafted from the roll the school already has. Nothing is saved. */
  @Get('grades/suggest')
  gradeSuggest(@Query('on') on?: string) {
    return this.grades.suggest(this.sid(), on ?? today());
  }

  @Post('grades')
  async gradeUpsert(@CurrentUser() u: SchoolJwtPayload, @Body() dto: UpsertGradeDto) {
    const r = await this.grades.upsert(this.sid(), u.sub, dto);
    await this.audit.record({
      schoolId: this.sid(), actorUserId: u.sub, action: 'salary.grade', entity: 'PayGrade', entityId: r.id,
      meta: { name: dto.name, bandMinMinor: dto.bandMinMinor, bandMaxMinor: dto.bandMaxMinor },
    });
    return r;
  }

  /** What a grade pays at a figure, without saving it — the split bar. */
  @Post('grades/preview')
  gradePreview(@Body() dto: PreviewGradeDto) {
    return this.grades.resolve(this.sid(), dto.overrides, dto.monthlyGrossMinor, dto.onISO ?? today());
  }

  /** The April job: one grade, one date, everyone on it moves. */
  @Post('grades/raise')
  async gradeRaise(@CurrentUser() u: SchoolJwtPayload, @Body() dto: RaiseGradeDto) {
    const r = await this.grades.raise(this.sid(), u.sub, dto);
    await this.audit.record({
      schoolId: this.sid(), actorUserId: u.sub, action: 'salary.grade.raise', entity: 'PayGrade', entityId: dto.gradeId,
      meta: { ...r, effectiveFrom: dto.effectiveFrom, percentBps: dto.percentBps ?? null, flatMinor: dto.flatMinor ?? null },
    });
    return r;
  }

  /** Put several people on a grade at once. */
  @Post('grades/assign')
  async gradeAssign(@CurrentUser() u: SchoolJwtPayload, @Body() dto: AssignGradeDto) {
    const r = await this.grades.assign(this.sid(), u.sub, dto.gradeId, dto.effectiveFrom, dto.rows);
    await this.audit.record({
      schoolId: this.sid(), actorUserId: u.sub, action: 'salary.grade.assign', entity: 'PayGrade', entityId: dto.gradeId,
      meta: { ...r, effectiveFrom: dto.effectiveFrom },
    });
    return r;
  }

  @Post('grades/:id/remove')
  async gradeRemove(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.grades.remove(this.sid(), id, today());
    await this.audit.record({
      schoolId: this.sid(), actorUserId: u.sub, action: 'salary.grade.remove', entity: 'PayGrade', entityId: id,
    });
    return r;
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
  /**
   * One person's bank and tax numbers, set by the office.
   *
   * Writes the same rows the employee's own screen writes, so whichever of
   * them types it, the other sees it. Deliberately NOT part of
   * `people/structure`: that creates a new pay row from a date, and a bank
   * account is not a change of pay.
   */
  @Get('people/:kind/:id/details')
  personDetails(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.people.details(this.sid(), kindOf(kind), id);
  }

  @Post('people/:kind/:id/details')
  async setPersonDetails(
    @CurrentUser() u: SchoolJwtPayload,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayDetailsDto,
  ) {
    const r = await this.people.setDetails(this.sid(), kindOf(kind), id, dto);
    await this.audit.record({
      schoolId: this.sid(), actorUserId: u.sub, action: 'salary.details', entity: 'EmployeePay', entityId: id,
      meta: { personKind: kindOf(kind), fields: Object.keys(dto) },
    });
    return r;
  }

  /**
   * Everybody who may be GIVEN the right to see pay: the school's admins, and
   * its accounts officers.
   *
   * The officers have to be here. `SalaryGuard` lets an `ACCOUNTS` staff
   * member through the door and then asks for `canSeeSalary` by name — so a
   * list of admins alone would be a door with no key anywhere in the product:
   * the officer is told to ask an admin, and the admin has nobody to click.
   */
  @Get('access')
  async access() {
    const schoolId = this.sid();
    const db = getPlatformPrisma();
    const [admins, officers] = await Promise.all([
      db.user.findMany({
        where: { schoolId, role: 'SCHOOL_ADMIN', isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true, canSeeSalary: true, createdAt: true },
        take: LIST_CEILING.STRUCTURE,
      }),
      db.staff.findMany({
        where: { schoolId, role: 'ACCOUNTS', isActive: true, userId: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, firstName: true, lastName: true },
        take: LIST_CEILING.STRUCTURE,
      }),
    ]);
    const officerUsers = officers.length === 0 ? [] : await db.user.findMany({
      where: { id: { in: officers.map((o) => o.userId!) }, schoolId, isActive: true },
      select: { id: true, name: true, email: true, canSeeSalary: true, createdAt: true },
      take: LIST_CEILING.STRUCTURE,
    });
    const nameByUser = new Map(officers.map((o) => [o.userId!, `${o.firstName} ${o.lastName ?? ''}`.trim()]));
    return [
      ...admins.map((a) => ({ ...a, job: 'Admin' as const })),
      ...officerUsers.map((u) => ({ ...u, name: nameByUser.get(u.id) ?? u.name, job: 'Accounts officer' as const })),
    ];
  }

  @Post('access')
  async grant(@CurrentUser() u: SchoolJwtPayload, @Body() dto: GrantSalaryDto) {
    const schoolId = this.sid();
    if (dto.userId === u.sub && !dto.canSeeSalary) {
      throw new ApiError('VALIDATION', 'You cannot take the salary right away from yourself — ask another admin who has it.', 400, 'userId');
    }
    const db = getPlatformPrisma();
    // An admin, or a login that holds the accounts job. Anyone else is not
    // somebody this right can be given to at all. Two reads rather than a
    // nested filter: `User` has no Prisma relation to `Staff`.
    const candidate = await db.user.findFirst({
      where: { id: dto.userId, schoolId, isActive: true },
      select: { id: true, role: true },
    });
    const isOfficer = candidate?.role === 'STAFF' && (await db.staff.count({
      where: { userId: candidate.id, schoolId, role: 'ACCOUNTS', isActive: true },
    })) > 0;
    const target = candidate && (candidate.role === 'SCHOOL_ADMIN' || isOfficer) ? candidate : null;
    if (!target) {
      throw new ApiError('NOT_FOUND', 'Pay can only be given to an admin or an accounts officer at this school.', 404, 'userId');
    }
    await db.user.update({ where: { id: dto.userId }, data: { canSeeSalary: dto.canSeeSalary } });
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

  /**
   * Anybody's payslip as a printable document.
   *
   * The same shape `/me/pay/payslips/:id/document` returns, on purpose: the
   * office's copy and the person's copy have to be one document, or a payslip
   * taken to a bank is not evidence of anything.
   */
  @Get('payslips/:id/document')
  payslipDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.payslipDocs.forAdmin(this.sid(), id);
  }

  @Get('statement/:kind/:id')
  statement(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Query('taxYear') taxYear: string) {
    return this.statutory.annualStatement(this.sid(), kindOf(kind), id, Number(taxYear));
  }
}

/** Today, as the date the rules and the roster are read at. */
const today = () => new Date().toISOString().slice(0, 10);

function kindOf(raw: string): 'TEACHER' | 'STAFF' {
  const k = raw.toUpperCase();
  if (k !== 'TEACHER' && k !== 'STAFF') throw new ApiError('VALIDATION', 'kind must be teacher or staff.', 400, 'kind');
  return k;
}
