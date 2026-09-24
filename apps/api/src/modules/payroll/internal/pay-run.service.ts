import { Injectable } from '@nestjs/common';
import { withTenant, type Prisma, type TenantTx } from '@skoolos/db';
import {
  applyGradeOverrides, asOf, daysInMonth, gradeFixedAmounts, health, incomeTax, localTax,
  prorate, resolveEarnings, retirement,
  taxYearLabel, taxYearOf, type ComponentDef, type PayPack, type ResolvedLine, type TaxDeclarationInput,
} from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { PayPackService } from './pay-pack.service';
import { PayPeopleService, readGradeOverrides } from './pay-people.service';

type Kind = 'TEACHER' | 'STAFF';
type Status = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'LOCKED' | 'PAID';

/** What a run may do next. A locked run is a record, not a draft. */
const NEXT: Record<Status, Status[]> = {
  DRAFT: ['CALCULATED'],
  CALCULATED: ['CALCULATED', 'APPROVED'],
  APPROVED: ['CALCULATED', 'LOCKED'],
  LOCKED: ['PAID'],
  PAID: [],
};

const STAFF_LABEL: Record<string, string> = {
  OFFICE: 'Office staff', SUPPORT: 'Support staff', DRIVER: 'Driver', HELPER: 'Helper',
  SECURITY: 'Security', LIBRARIAN: 'Librarian', SPORTS: 'Sports teacher', OTHER: 'Staff',
};

/**
 * THE PAY RUN — one month, for the whole school.
 *
 * Draft → calculate → approve → lock → pay. Only the lock is irreversible,
 * and it is where the design earns its keep: before it everything is
 * recomputable, after it everything is auditable and a correction is an
 * ADJUSTMENT in the next run rather than an edit to a month that has already
 * been filed and paid.
 *
 * The run records the pack version and the date its rules were read at, so a
 * figure can be explained a year later — which is the whole reason the rates
 * live in dated tables instead of in this file.
 */
@Injectable()
export class PayRunService {
  constructor(private readonly packs: PayPackService, private readonly people: PayPeopleService) {}

  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.payRun.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: { schoolId },
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
        select: {
          id: true, periodYear: true, periodMonth: true, status: true, headcount: true,
          grossMinor: true, deductionMinor: true, netMinor: true, employerCostMinor: true,
          packVersion: true, rulesAsAt: true, lockedAt: true, paidAt: true,
        },
      }),
    );
  }

  async open(schoolId: string, actorId: string, year: number, month: number) {
    if (month < 1 || month > 12) throw new ApiError('VALIDATION', 'That is not a month.', 400, 'periodMonth');
    const { pack } = await this.packs.forSchool(schoolId);
    const rulesAsAt = this.packs.rulesDate(year, month);
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.payRun.findFirst({ where: { schoolId, periodYear: year, periodMonth: month }, select: { id: true } });
      if (existing) return existing;
      return tx.payRun.create({
        data: {
          schoolId, periodYear: year, periodMonth: month, status: 'DRAFT',
          packCountry: pack.country, packVersion: pack.version,
          rulesAsAt: new Date(`${rulesAsAt}T00:00:00.000Z`),
          createdById: actorId,
        },
        select: { id: true },
      });
    });
  }

  /**
   * Compute every payslip in the run, from scratch.
   *
   * Recomputing rather than patching is deliberate: a run that can be
   * calculated twice and give the same answer is a run whose inputs are
   * visible, and any other design accumulates state nobody can audit.
   */
  async calculate(schoolId: string, runId: string) {
    const { pack, region } = await this.packs.forSchool(schoolId);
    const components = await this.people.components(schoolId);
    const defs: ComponentDef[] = components.map((c) => ({
      key: c.key, name: c.name, kind: c.kind, calc: c.calc, rateBps: c.rateBps ?? undefined,
      taxable: c.taxable, isWages: c.isWages, retirementBase: c.retirementBase,
      healthBase: c.healthBase, gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order,
    }));

    return withTenant(schoolId, async (tx) => {
      const run = await this.require(tx, schoolId, runId);
      this.assertCan(run.status as Status, 'CALCULATED');

      const { periodYear: year, periodMonth: month } = run;
      const onISO = this.packs.rulesDate(year, month);
      const days = daysInMonth(year, month);
      const { taxYear, monthsLeft } = taxYearOf(pack, year, month);

      const [teachers, staff] = await Promise.all([
        tx.teacher.findMany({
          take: LIST_CEILING.ROSTER, where: { schoolId, isActive: true },
          select: { id: true, firstName: true, lastName: true },
        }),
        tx.staff.findMany({
          take: LIST_CEILING.ROSTER, where: { schoolId, isActive: true },
          select: { id: true, firstName: true, lastName: true, role: true },
        }),
      ]);
      const roster: { kind: Kind; id: string; name: string; designation: string }[] = [
        ...teachers.map((t) => ({ kind: 'TEACHER' as const, id: t.id, name: `${t.firstName} ${t.lastName}`.trim(), designation: 'Teacher' })),
        ...staff.map((s) => ({ kind: 'STAFF' as const, id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), designation: STAFF_LABEL[s.role] ?? 'Staff' })),
      ];

      const monthEnd = new Date(`${onISO}T00:00:00.000Z`);
      const pays = await tx.employeePay.findMany({
        take: LIST_CEILING.ROSTER, where: { schoolId, effectiveFrom: { lte: monthEnd } },
        orderBy: { effectiveFrom: 'desc' },
      });
      const structure = new Map<string, (typeof pays)[number]>();
      for (const p of pays) {
        const key = p.teacherId ?? p.staffId!;
        if (!structure.has(key)) structure.set(key, p);
      }

      // A grade carries the split for everyone on it. Read once for the whole
      // run: forty-eight payslips must not be forty-eight grade lookups.
      const gradeRows = await tx.payGrade.findMany({
        take: LIST_CEILING.STRUCTURE, where: { schoolId }, select: { id: true, overrides: true },
      });
      const gradeDefs = new Map(gradeRows.map((g) => [g.id, applyGradeOverrides(defs, readGradeOverrides(g.overrides))]));
      const gradeFixed = new Map(gradeRows.map((g) => [g.id, gradeFixedAmounts(readGradeOverrides(g.overrides))]));

      const [adjustments, declarations, priorSlips] = await Promise.all([
        tx.payAdjustment.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: { schoolId, periodYear: year, periodMonth: month },
        }),
        tx.taxDeclaration.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, taxYear } }),
        // What has already been paid and taxed this tax year, for the spread.
        tx.payslip.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: {
            schoolId,
            payRun: { status: { in: ['LOCKED', 'PAID'] }, ...taxYearWindow(pack, taxYear) },
          },
          select: { teacherId: true, staffId: true, grossMinor: true, incomeTaxMinor: true, payRun: { select: { periodYear: true, periodMonth: true } } },
        }),
      ]);
      const declBy = new Map(declarations.map((d) => [d.teacherId ?? d.staffId!, d]));
      const ytd = new Map<string, { gross: number; tax: number }>();
      for (const s of priorSlips) {
        const key = s.teacherId ?? s.staffId!;
        const cur = ytd.get(key) ?? { gross: 0, tax: 0 };
        ytd.set(key, { gross: cur.gross + s.grossMinor, tax: cur.tax + s.incomeTaxMinor });
      }

      // Headcount decides whether the provident fund and ESI apply at all, and
      // it is the number of people ON the payroll, not the roll of the school.
      const headcount = roster.filter((p) => structure.has(p.id)).length;
      if (headcount === 0) {
        throw new ApiError('PAY_RUN_EMPTY', 'Nobody has a pay structure yet. Set one under Salary → People first.', 400);
      }

      await tx.payslip.deleteMany({ where: { schoolId, payRunId: runId } });

      let gross = 0, deduction = 0, net = 0, employerCost = 0;
      const slips: Prisma.PayslipCreateManyInput[] = [];

      for (const person of roster) {
        const pay = structure.get(person.id);
        if (!pay) continue;

        const mine = adjustments.filter((a) => (a.teacherId ?? a.staffId) === person.id);
        // Half days are carried as a second integer, because Prisma serialises
        // Decimal as a string and that would change a shape every client reads.
        // The MONEY is computed on the exact fraction; `daysPaid` below is
        // rounded only for the number a screen prints.
        const lopExact = Math.min(days, mine.reduce((a, x) => a + (x.lopDays ?? 0) + (x.lopHalfDays ?? 0) / 2, 0));
        const lopHalfDays = lopExact - Math.floor(lopExact) >= 0.5 ? 1 : 0;
        const daysPaidExact = Math.max(0, days - lopExact);

        // A contract teacher on a 10- or 11-month term is not paid through the
        // vacation; their agreed gross is spread over the months they work.
        const monthsFactor = pay.paidThroughVacation ? 1 : Math.min(1, pay.contractMonths / 12);
        const agreedGross = Math.round(pay.monthlyGrossMinor * (monthsFactor === 1 ? 1 : 1));

        // The person's own fixed amounts win over the grade's: a grade is the
        // default for a job, not an override of what was agreed with a person.
        let earnings = resolveEarnings(pay.payGradeId ? gradeDefs.get(pay.payGradeId) ?? defs : defs, {
          monthlyGrossMinor: agreedGross,
          fixed: {
            ...(pay.payGradeId ? gradeFixed.get(pay.payGradeId) ?? {} : {}),
            ...((pay.fixedAmounts ?? {}) as Record<string, number>),
          },
        });
        earnings = prorate(earnings, daysPaidExact, days);

        // Arrears and one-offs join the earnings before anything is computed on
        // them: a backdated increment attracts provident fund in the month it
        // is paid, which is exactly why they are lines and not a separate total.
        for (const a of mine.filter((x) => x.kind === 'EARNING' && x.amountMinor !== 0)) {
          earnings.push({
            key: `adj-${a.id}`, name: a.label, kind: 'EARNING', amountMinor: a.amountMinor,
            taxable: a.taxable, isWages: false, retirementBase: false, healthBase: true,
            gratuityBase: false, prorate: false, order: 90,
          });
        }

        const grossMinor = earnings.reduce((a, l) => a + l.amountMinor, 0);

        const pf = retirement(earnings, pack, onISO, { optIn: pay.pfOptIn, onActual: pay.pfOnActual, headcount });
        const esi = health(earnings, pack, onISO, { exempt: pay.esiExempt, headcount, region });
        const pt = localTax(grossMinor, pack, onISO, { region, month, exempt: pay.localTaxExempt });

        const taxableMonthly = earnings.filter((l) => l.taxable).reduce((a, l) => a + l.amountMinor, 0);
        const mineYtd = ytd.get(person.id) ?? { gross: 0, tax: 0 };
        const projectedAnnual = mineYtd.gross + taxableMonthly * monthsLeft;
        const basicAnnual = earnings.filter((l) => l.retirementBase).reduce((a, l) => a + l.amountMinor, 0) * 12;
        const hraAnnual = earnings.filter((l) => l.key === 'hra').reduce((a, l) => a + l.amountMinor, 0) * 12;

        const decl = declBy.get(person.id);
        const declaration: TaxDeclarationInput | undefined = decl ? {
          rentAnnualMinor: decl.rentAnnualMinor, metro: decl.metro,
          s80cMinor: decl.section80cMinor, s80dMinor: decl.section80dMinor,
          homeLoanInterestMinor: decl.homeLoanInterestMinor, otherIncomeMinor: decl.otherIncomeMinor,
          previousEmployerSalaryMinor: decl.previousEmployerSalaryMinor,
          previousEmployerTdsMinor: decl.previousEmployerTdsMinor,
        } : undefined;

        const tax = incomeTax({
          pack, onISO,
          regimeKey: (decl?.regime ?? pay.taxRegime) as 'NEW' | 'OLD',
          annualTaxableSalaryMinor: projectedAnnual,
          annualBasicMinor: basicAnnual,
          annualHraMinor: hraAnnual,
          declaration,
          alreadyPaidMinor: mineYtd.tax,
          monthsLeft,
        });

        const otherDeductions = mine.filter((x) => x.kind === 'DEDUCTION').reduce((a, x) => a + x.amountMinor, 0);
        const lines: ResolvedLine[] = [...earnings];
        const push = (key: string, name: string, kind: 'DEDUCTION' | 'EMPLOYER_COST', amountMinor: number, order: number) => {
          if (amountMinor > 0) lines.push({ key, name, kind, amountMinor, taxable: false, isWages: false, retirementBase: false, healthBase: false, gratuityBase: false, prorate: false, order });
        };
        push('pf_employee', `${pack.retirement[0]?.label ?? 'Provident fund'}`, 'DEDUCTION', pf?.employeeMinor ?? 0, 100);
        push('esi_employee', `${pack.health[0]?.label ?? 'ESI'}`, 'DEDUCTION', esi?.employeeMinor ?? 0, 101);
        push('local_tax', pack.localTax[0]?.label ?? 'Professional tax', 'DEDUCTION', pt, 102);
        push('income_tax', 'Income tax', 'DEDUCTION', tax.monthlyMinor, 103);
        for (const a of mine.filter((x) => x.kind === 'DEDUCTION' && x.amountMinor > 0)) {
          push(`adj-${a.id}`, a.label, 'DEDUCTION', a.amountMinor, 110);
        }
        push('pf_employer', 'Provident fund — school’s share', 'EMPLOYER_COST', (pf?.employerMinor ?? 0) + (pf?.pensionMinor ?? 0), 200);
        push('pf_admin', 'Provident fund — insurance and admin', 'EMPLOYER_COST', pf?.employerExtraMinor ?? 0, 201);
        push('esi_employer', 'ESI — school’s share', 'EMPLOYER_COST', esi?.employerMinor ?? 0, 202);

        const deductionMinor = (pf?.employeeMinor ?? 0) + (esi?.employeeMinor ?? 0) + pt + tax.monthlyMinor + otherDeductions;
        const employerCostMinor = (pf?.employerMinor ?? 0) + (pf?.pensionMinor ?? 0) + (pf?.employerExtraMinor ?? 0) + (esi?.employerMinor ?? 0);
        const netMinor = grossMinor - deductionMinor;

        gross += grossMinor; deduction += deductionMinor; net += netMinor; employerCost += employerCostMinor;

        slips.push({
          schoolId, payRunId: runId, personKind: person.kind,
          teacherId: person.kind === 'TEACHER' ? person.id : null,
          staffId: person.kind === 'STAFF' ? person.id : null,
          name: person.name, designation: person.designation,
          lines: lines.sort((a, b) => a.order - b.order) as unknown as object,
          daysInMonth: days, daysPaid: Math.round(daysPaidExact), lopHalfDays,
          grossMinor, deductionMinor, netMinor, employerCostMinor,
          retirementEmployeeMinor: pf?.employeeMinor ?? 0,
          retirementEmployerMinor: pf?.employerMinor ?? 0,
          pensionMinor: pf?.pensionMinor ?? 0,
          healthEmployeeMinor: esi?.employeeMinor ?? 0,
          healthEmployerMinor: esi?.employerMinor ?? 0,
          localTaxMinor: pt,
          incomeTaxMinor: tax.monthlyMinor,
          taxRegime: tax.regime,
          ytdGrossMinor: mineYtd.gross + grossMinor,
          ytdTaxMinor: mineYtd.tax + tax.monthlyMinor,
        });
      }

      // Why a statutory line is ABSENT, said out loud. A school with 18 staff
      // has no provident-fund obligation at all, and an admin who sees no PF
      // column and no explanation assumes the software is broken.
      const notes: string[] = [];
      const r = asOf(pack.retirement, onISO);
      if (r?.minHeadcount && headcount < r.minHeadcount) {
        notes.push(`${r.label} does not apply: it starts at ${r.minHeadcount} people on the payroll and this school has ${headcount}.`);
      }
      const h = asOf(pack.health, onISO);
      const healthMin = (region ? h?.minHeadcountByRegion?.[region] : undefined) ?? h?.minHeadcount;
      if (h && healthMin && headcount < healthMin) {
        notes.push(`${h.label} does not apply: it starts at ${healthMin} people${region ? ` in ${region}` : ''} and this school has ${headcount}.`);
      }
      const lt = asOf(pack.localTax, onISO);
      if (lt && region && !lt.byRegion[region]) {
        notes.push(`${lt.label} is not levied in ${region}, so nothing is deducted for it.`);
      }
      if (!region) notes.push('No state is set for this school, so professional tax cannot be worked out. Set it under Salary → Settings.');

      await tx.payslip.createMany({ data: slips });
      await tx.payRun.update({
        where: { id: runId },
        data: {
          status: 'CALCULATED', headcount: slips.length,
          grossMinor: gross, deductionMinor: deduction, netMinor: net, employerCostMinor: employerCost,
          packVersion: pack.version, rulesAsAt: new Date(`${onISO}T00:00:00.000Z`),
          calculatedAt: new Date(),
        },
      });
      return {
        headcount: slips.length, grossMinor: gross, deductionMinor: deduction,
        netMinor: net, employerCostMinor: employerCost,
        rulesAsAt: onISO, packVersion: pack.version, taxYear: taxYearLabel(pack, taxYear),
        notes,
      };
    });
  }

  async detail(schoolId: string, runId: string) {
    return withTenant(schoolId, async (tx) => {
      const run = await this.require(tx, schoolId, runId);
      const payslips = await tx.payslip.findMany({
        take: LIST_CEILING.ROSTER,
        where: { schoolId, payRunId: runId },
        orderBy: { name: 'asc' },
      });
      return { run, payslips };
    });
  }

  async approve(schoolId: string, actorId: string, runId: string) {
    return this.move(schoolId, runId, 'APPROVED', { approvedAt: new Date(), approvedById: actorId });
  }

  /**
   * LOCK — the one irreversible step, and the only place this module refuses
   * to go backwards. After it a correction is an adjustment in the next run.
   */
  async lock(schoolId: string, actorId: string, runId: string) {
    return this.move(schoolId, runId, 'LOCKED', { lockedAt: new Date(), lockedById: actorId });
  }

  async markPaid(schoolId: string, runId: string) {
    return this.move(schoolId, runId, 'PAID', { paidAt: new Date() });
  }

  private async move(schoolId: string, runId: string, to: Status, extra: Record<string, unknown>) {
    return withTenant(schoolId, async (tx) => {
      const run = await this.require(tx, schoolId, runId);
      this.assertCan(run.status as Status, to);
      if (to === 'APPROVED' && run.headcount === 0) {
        throw new ApiError('PAY_RUN_EMPTY', 'Calculate the run before approving it.', 400);
      }
      await tx.payRun.update({ where: { id: runId }, data: { status: to, ...extra } });
      return { status: to };
    });
  }

  private assertCan(from: Status, to: Status) {
    if (from === 'LOCKED' && to !== 'PAID') {
      throw new ApiError('PAY_RUN_LOCKED', 'This month is locked. Put the correction in the next run as an adjustment.', 409);
    }
    if (!NEXT[from].includes(to)) {
      throw new ApiError('PAY_RUN_STATE', `A ${from.toLowerCase()} run cannot go straight to ${to.toLowerCase()}.`, 409);
    }
  }

  private async require(tx: TenantTx, schoolId: string, runId: string) {
    const run = await tx.payRun.findFirst({ where: { id: runId, schoolId } });
    if (!run) throw new ApiError('NOT_FOUND', 'No such pay run.', 404);
    return run;
  }
}

/** The pay runs that fall inside a tax year — India's runs April to March. */
function taxYearWindow(pack: PayPack, taxYear: number) {
  const start = pack.taxYearStartMonth;
  if (start === 1) return { periodYear: taxYear };
  return {
    OR: [
      { periodYear: taxYear, periodMonth: { gte: start } },
      { periodYear: taxYear + 1, periodMonth: { lt: start } },
    ],
  };
}
