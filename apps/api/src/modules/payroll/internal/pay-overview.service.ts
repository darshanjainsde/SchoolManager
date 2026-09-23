import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import {
  applyGradeOverrides, gradeFixedAmounts, health, resolveEarnings, retirement,
  type ComponentDef,
} from '@skoolos/types';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { PayPackService } from './pay-pack.service';
import { PayPeopleService, readGradeOverrides } from './pay-people.service';

export type ExceptionKind = 'NO_GRADE' | 'NO_PAY' | 'NO_BANK' | 'OUT_OF_BAND' | 'ARREARS';

export interface PayException {
  kind: ExceptionKind;
  count: number;
  /** One line, already written — the screen shows it, it does not compose it. */
  label: string;
  /** Up to three names, so the count is not the only thing a person can see. */
  names: string[];
  /** Where the fix is. */
  goTo: 'people' | 'grades';
}

export interface PayOverview {
  /** Where the school is in setting the module up. The home screen's shape. */
  setup: {
    countryCode: string;
    gradeCount: number;
    rosterSize: number;
    onPay: number;
    notOnPay: number;
    /** True once there is a grade AND at least one person on the payroll. */
    ready: boolean;
  };
  period: { year: number; month: number };
  /** The run for this month, if one has been opened. */
  run: {
    id: string; status: string; headcount: number;
    grossMinor: number; deductionMinor: number; netMinor: number; employerCostMinor: number;
  } | null;
  /**
   * What the month costs. From the run once it has been worked out; before
   * that, computed here from the structures in force — the same engine, no
   * writes, so the figure a school plans with is the figure it will pay.
   */
  cost: {
    estimated: boolean;
    headcount: number;
    grossMinor: number;
    deductionMinor: number;
    netMinor: number;
    employerCostMinor: number;
    /** Gross plus the school's own contributions — what leaves the school. */
    totalCostMinor: number;
  };
  /** The month before, for "about the same as September". */
  previousTotalMinor: number | null;
  exceptions: PayException[];
  recent: {
    id: string; periodYear: number; periodMonth: number; status: string;
    headcount: number; grossMinor: number; employerCostMinor: number; netMinor: number;
  }[];
}

const nameOf = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();


/**
 * THE HOME SCREEN'S DATA.
 *
 * One call, because the page it feeds asks one question — "where am I in the
 * month and what needs me" — and a page that asks one question should not
 * make five requests to answer it.
 *
 * The exceptions are the point. Without them, reviewing a month means reading
 * forty-eight rows looking for nothing; with them it is three lines and a
 * button. Everything else on the screen is a figure, and figures do not need
 * a human.
 */
@Injectable()
export class PayOverviewService {
  constructor(
    private readonly packs: PayPackService,
    private readonly people: PayPeopleService,
  ) {}

  async overview(schoolId: string, year: number, month: number): Promise<PayOverview> {
    const { pack, region, countryCode } = await this.packs.forSchool(schoolId);
    const onISO = this.packs.rulesDate(year, month);
    const comps = await this.people.components(schoolId);
    const baseDefs: ComponentDef[] = comps.map((c) => ({
      key: c.key, name: c.name, kind: c.kind, calc: c.calc, rateBps: c.rateBps ?? undefined,
      taxable: c.taxable, isWages: c.isWages, retirementBase: c.retirementBase,
      healthBase: c.healthBase, gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order,
    }));

    return withTenant(schoolId, async (tx) => {
      const monthEnd = new Date(`${onISO}T00:00:00.000Z`);
      const [teachers, staff, grades, pays, run, recent, adjustments] = await Promise.all([
        tx.teacher.findMany({
          take: LIST_CEILING.ROSTER, where: { schoolId, isActive: true },
          select: { id: true, firstName: true, lastName: true },
        }),
        tx.staff.findMany({
          take: LIST_CEILING.ROSTER, where: { schoolId, isActive: true },
          select: { id: true, firstName: true, lastName: true },
        }),
        tx.payGrade.findMany({
          take: LIST_CEILING.STRUCTURE, where: { schoolId },
          select: { id: true, name: true, bandMinMinor: true, bandMaxMinor: true, overrides: true },
        }),
        tx.employeePay.findMany({
          take: LIST_CEILING.ROSTER, where: { schoolId, effectiveFrom: { lte: monthEnd } },
          orderBy: { effectiveFrom: 'desc' },
        }),
        tx.payRun.findFirst({ where: { schoolId, periodYear: year, periodMonth: month } }),
        tx.payRun.findMany({
          take: 12, where: { schoolId },
          orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
        }),
        tx.payAdjustment.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: { schoolId, periodYear: year, periodMonth: month, kind: 'EARNING' },
          select: { teacherId: true, staffId: true, amountMinor: true },
        }),
      ]);

      const roster = [
        ...teachers.map((t) => ({ kind: 'TEACHER' as const, id: t.id, name: nameOf(t) })),
        ...staff.map((s) => ({ kind: 'STAFF' as const, id: s.id, name: nameOf(s) })),
      ];
      const byId = new Map(roster.map((p) => [p.id, p]));

      const structure = new Map<string, (typeof pays)[number]>();
      for (const p of pays) {
        const key = p.teacherId ?? p.staffId!;
        if (!structure.has(key)) structure.set(key, p);
      }
      const gradeById = new Map(grades.map((g) => [g.id, g]));

      // ── what the month costs ────────────────────────────────────────────
      // From the run once it has been worked out; otherwise the same maths,
      // in memory. A school should never have to run the month to find out
      // whether it can afford to.
      let cost: PayOverview['cost'];
      const headcount = roster.filter((p) => structure.has(p.id)).length;

      if (run && run.status !== 'DRAFT') {
        cost = {
          estimated: false, headcount: run.headcount,
          grossMinor: run.grossMinor, deductionMinor: run.deductionMinor,
          netMinor: run.netMinor, employerCostMinor: run.employerCostMinor,
          totalCostMinor: run.grossMinor + run.employerCostMinor,
        };
      } else {
        let gross = 0, employer = 0, employeeStat = 0;
        for (const person of roster) {
          const pay = structure.get(person.id);
          if (!pay) continue;
          const overrides = pay.payGradeId ? readGradeOverrides(gradeById.get(pay.payGradeId)?.overrides) : {};
          const defs = applyGradeOverrides(baseDefs, overrides);
          const fixed = { ...gradeFixedAmounts(overrides), ...((pay.fixedAmounts ?? {}) as Record<string, number>) };
          const lines = resolveEarnings(defs, { monthlyGrossMinor: pay.monthlyGrossMinor, fixed });
          const g = lines.reduce((a, l) => a + l.amountMinor, 0);
          gross += g;
          const pf = retirement(lines, pack, onISO, { optIn: pay.pfOptIn, onActual: pay.pfOnActual, headcount });
          const esi = health(lines, pack, onISO, { exempt: pay.esiExempt, headcount, region });
          employer += (pf?.employerMinor ?? 0) + (pf?.pensionMinor ?? 0) + (pf?.employerExtraMinor ?? 0) + (esi?.employerMinor ?? 0);
          employeeStat += (pf?.employeeMinor ?? 0) + (esi?.employeeMinor ?? 0);
        }
        // Income tax is left out of the estimate on purpose: it depends on
        // declarations that may still change, and a figure that moves after
        // the school has planned with it is worse than one it knows is absent.
        cost = {
          estimated: true, headcount,
          grossMinor: gross, deductionMinor: employeeStat,
          netMinor: gross - employeeStat, employerCostMinor: employer,
          totalCostMinor: gross + employer,
        };
      }

      // ── what needs a human ──────────────────────────────────────────────
      const noPay: string[] = [];
      const noGrade: string[] = [];
      const noBank: string[] = [];
      const outOfBand: string[] = [];
      for (const person of roster) {
        const pay = structure.get(person.id);
        if (!pay) { noPay.push(person.name); continue; }
        if (!pay.payGradeId) noGrade.push(person.name);
        if (!pay.bankAccount) noBank.push(person.name);
        const g = pay.payGradeId ? gradeById.get(pay.payGradeId) : null;
        if (g && g.bandMaxMinor > 0 && (pay.monthlyGrossMinor < g.bandMinMinor || pay.monthlyGrossMinor > g.bandMaxMinor)) {
          outOfBand.push(person.name);
        }
      }
      const arrearsNames = [...new Set(
        adjustments.map((a) => byId.get((a.teacherId ?? a.staffId)!)?.name).filter((n): n is string => !!n),
      )];

      const exceptions: PayException[] = [];
      const add = (kind: ExceptionKind, names: string[], one: string, many: string, goTo: 'people' | 'grades') => {
        if (names.length === 0) return;
        exceptions.push({
          kind, count: names.length, names: names.slice(0, 3), goTo,
          label: names.length === 1 ? `${names[0]} ${one}` : `${names.length} people ${many}`,
        });
      };
      add('NO_PAY', noPay, 'has no pay set', 'have no pay set', 'people');
      add('NO_GRADE', noGrade, 'is not on a grade', 'are not on a grade', 'people');
      add('NO_BANK', noBank, 'has no bank account', 'have no bank account', 'people');
      add('OUT_OF_BAND', outOfBand, 'is paid outside their band', 'are paid outside their band', 'grades');
      add('ARREARS', arrearsNames, 'has arrears this month', 'have arrears this month', 'people');

      const prev = recent.find((r) => !(r.periodYear === year && r.periodMonth === month) && (r.status === 'LOCKED' || r.status === 'PAID'));

      return {
        setup: {
          countryCode,
          gradeCount: grades.length,
          rosterSize: roster.length,
          onPay: headcount,
          notOnPay: roster.length - headcount,
          ready: grades.length > 0 && headcount > 0,
        },
        period: { year, month },
        run: run ? {
          id: run.id, status: run.status, headcount: run.headcount,
          grossMinor: run.grossMinor, deductionMinor: run.deductionMinor,
          netMinor: run.netMinor, employerCostMinor: run.employerCostMinor,
        } : null,
        cost,
        previousTotalMinor: prev ? prev.grossMinor + prev.employerCostMinor : null,
        exceptions,
        recent: recent.map((r) => ({
          id: r.id, periodYear: r.periodYear, periodMonth: r.periodMonth, status: r.status,
          headcount: r.headcount, grossMinor: r.grossMinor,
          employerCostMinor: r.employerCostMinor, netMinor: r.netMinor,
        })),
      };
    });
  }
}
