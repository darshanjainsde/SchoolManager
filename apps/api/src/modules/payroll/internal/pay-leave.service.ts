import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import {
  computeLop, countableDates, datesBetween, datesInMonth, fmt, proRataAllotment, workingDaysIn,
  type LeaveBalanceIn, type LeaveDaysIn, type LeaveTypeRule, type LopBasis, type LopOptions,
} from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

export interface LeaveProposal {
  personKind: 'TEACHER' | 'STAFF';
  personId: string;
  name: string;
  /** Unpaid days, possibly ending in .5. */
  lopDays: number;
  lopWholeDays: number;
  lopHalfDays: number;
  /** "Casual 14 of 12 used → 2 days over" — the arithmetic, said out loud. */
  reasons: string[];
  /** Already written into this month as an adjustment. */
  applied: boolean;
  /**
   * One of the approved applications this deduction came from.
   *
   * Stored on the adjustment so a second call can SEE that this person's
   * leave has already been charged. Writing null there would have made
   * `applied` permanently false and let the same days be deducted twice.
   */
  anchorApplicationId: string;
  /** True when the deduction would take the whole month's pay. */
  clamped: boolean;
}

export interface LeaveMonth {
  basis: LopBasis;
  countHalfDays: boolean;
  daysInMonth: number;
  workingDays: number;
  proposals: LeaveProposal[];
  /** Overruns the school chose not to deduct, and pending leave left out. */
  warnings: string[];
  /** Approved leave exists but the month is locked — these go to next month. */
  locked: boolean;
}

/**
 * LEAVE, TURNED INTO DAYS THIS MONTH DOES NOT PAY FOR.
 *
 * It proposes; it never applies by itself. A deduction that appeared without
 * anybody choosing it is the fastest way to lose a school's trust in a payroll,
 * and the cost of being wrong is somebody's rent. So this reads approved leave,
 * works out what it would cost, says why for each line, and waits.
 *
 * Only APPROVED leave counts. Pending leave is reported as something that needs
 * a person, never deducted — the office may still reject it.
 */
@Injectable()
export class PayLeaveService {
  /** What the school decided, plus the calendar the basis needs. */
  private async policy(schoolId: string, year: number, month: number) {
    return withTenant(schoolId, async (tx) => {
      const school = await tx.school.findFirst({
        where: { id: schoolId },
        select: { lopBasis: true, lopCountsHalfDays: true, workingDays: true },
      });
      const first = new Date(Date.UTC(year, month - 1, 1));
      const last = new Date(Date.UTC(year, month, 0));
      // A holiday is a RANGE — a Diwali break is one row covering several
      // days — so it is expanded into the dates it actually closes, clipped
      // to this month. `endDate` null means a single day.
      const holidays = await tx.holiday.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, startDate: { lte: last }, OR: [{ endDate: null, startDate: { gte: first } }, { endDate: { gte: first } }] },
        select: { startDate: true, endDate: true },
      });
      const closed = new Set<string>();
      for (const h of holidays) {
        const from = h.startDate.toISOString().slice(0, 10);
        const to = (h.endDate ?? h.startDate).toISOString().slice(0, 10);
        for (const d of datesInMonth(from, to, year, month)) closed.add(d);
      }
      return {
        basis: (school?.lopBasis ?? 'CALENDAR_DAY') as LopBasis,
        countHalfDays: school?.lopCountsHalfDays ?? true,
        workingDays: school?.workingDays ?? [1, 2, 3, 4, 5, 6],
        holidays: [...closed],
      };
    });
  }

  /**
   * What this month's approved leave would cost, per person.
   *
   * `applied` says whether the office has already accepted a line, so calling
   * this twice cannot propose the same deduction twice.
   */
  async month(schoolId: string, year: number, month: number): Promise<LeaveMonth> {
    const pol = await this.policy(schoolId, year, month);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const opts: LopOptions = {
      basis: pol.basis, countHalfDays: pol.countHalfDays,
      workingDays: pol.workingDays, holidays: pol.holidays,
    };

    return withTenant(schoolId, async (tx) => {
      const first = new Date(Date.UTC(year, month - 1, 1));
      const last = new Date(Date.UTC(year, month, 0));

      const [types, apps, run] = await Promise.all([
        tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId } }),
        // Overlap, not containment: a leave from 28 Sep to 3 Oct belongs to
        // BOTH months and each takes its own slice.
        tx.leaveApplication.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: { schoolId, startDate: { lte: last }, endDate: { gte: first } },
        }),
        tx.payRun.findFirst({ where: { schoolId, periodYear: year, periodMonth: month }, select: { status: true } }),
      ]);

      const rules = new Map<string, LeaveTypeRule>(
        types.map((t) => [t.id, { id: t.id, name: t.name, isPaid: t.isPaid, neverDeduct: t.neverDeduct }]),
      );

      const approved = apps.filter((a) => a.status === 'APPROVED');
      const pending = apps.filter((a) => a.status === 'PENDING');

      const people = new Map<string, { kind: 'TEACHER' | 'STAFF'; id: string; days: LeaveDaysIn[] }>();
      for (const a of approved) {
        const kind = a.staffId ? ('STAFF' as const) : ('TEACHER' as const);
        const id = (a.staffId ?? a.teacherId)!;
        const dates = datesInMonth(
          a.startDate.toISOString().slice(0, 10),
          a.endDate.toISOString().slice(0, 10),
          year, month,
        );
        if (dates.length === 0) continue;
        const row = people.get(id) ?? { kind, id, days: [] };
        row.days.push({ applicationId: a.id, typeId: a.typeDefId ?? a.type, dates, halfDay: a.halfDay });
        people.set(id, row);
      }
      if (people.size === 0 && pending.length === 0) {
        return {
          basis: pol.basis, countHalfDays: pol.countHalfDays, daysInMonth,
          workingDays: workingDaysIn(year, month, pol.workingDays, pol.holidays),
          proposals: [], warnings: [], locked: run?.status === 'LOCKED' || run?.status === 'PAID',
        };
      }

      const ids = [...people.keys()];
      const [teachers, staff, allocations, already, pays] = await Promise.all([
        tx.teacher.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }),
        tx.staff.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }),
        tx.leaveAllocation.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, teacherId: { in: ids } } }),
        tx.payAdjustment.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: { schoolId, periodYear: year, periodMonth: month, leaveApplicationId: { not: null } },
          select: { teacherId: true, staffId: true },
        }),
        tx.employeePay.findMany({
          take: LIST_CEILING.ROSTER, where: { schoolId, effectiveFrom: { lte: last } },
          orderBy: { effectiveFrom: 'desc' },
          select: { teacherId: true, staffId: true, joinedOn: true },
        }),
      ]);
      const nameOf = new Map<string, string>([
        ...teachers.map((t) => [t.id, `${t.firstName} ${t.lastName}`.trim()] as const),
        ...staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`.trim()] as const),
      ]);
      const appliedFor = new Set(already.map((a) => (a.staffId ?? a.teacherId)!));
      const joinedOn = new Map<string, Date | null>();
      for (const p of pays) {
        const key = (p.staffId ?? p.teacherId)!;
        if (!joinedOn.has(key)) joinedOn.set(key, p.joinedOn);
      }

      // What each person had already used earlier in the SAME year, so the
      // quota is consumed in date order rather than reset every month.
      const yearStart = new Date(Date.UTC(year, 0, 1));
      const [usedBefore, earlierHolidays] = await Promise.all([
        tx.leaveApplication.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: { schoolId, status: 'APPROVED', startDate: { gte: yearStart, lt: first } },
          select: { teacherId: true, staffId: true, typeDefId: true, type: true, startDate: true, endDate: true, halfDay: true },
        }),
        // The holidays for the REST of the year so far. `pol.holidays` covers
        // only the month being computed, and counting an earlier leave without
        // them would measure it by a different rule than this month's.
        tx.holiday.findMany({
          take: LIST_CEILING.STRUCTURE,
          where: { schoolId, startDate: { lt: first }, OR: [{ endDate: null, startDate: { gte: yearStart } }, { endDate: { gte: yearStart } }] },
          select: { startDate: true, endDate: true },
        }),
      ]);
      const closedBefore = new Set<string>(pol.holidays);
      for (const h of earlierHolidays) {
        const from = h.startDate.toISOString().slice(0, 10);
        const to = (h.endDate ?? h.startDate).toISOString().slice(0, 10);
        for (const d of datesBetween(from, to)) closedBefore.add(d);
      }
      // Same rule, different window — this is what keeps "14 of 12 used" the
      // same arithmetic as the deduction underneath it.
      const beforeOpts: LopOptions = { ...opts, holidays: [...closedBefore] };

      const proposals: LeaveProposal[] = [];
      const warnings: string[] = [];

      for (const [id, row] of people) {
        const usedByType = new Map<string, number>();
        for (const u of usedBefore) {
          if ((u.staffId ?? u.teacherId) !== id) continue;
          const key = u.typeDefId ?? u.type;
          // THE BUG THIS REPLACES: these dates were counted as raw calendar
          // days while the month being computed went through
          // `countableDates`. Under WORKING_DAY a Sunday inside an earlier
          // leave therefore consumed quota that the same Sunday in THIS month
          // would not — so a person could be told "14 of 12 used" when the
          // consistent answer was 13, and be charged a day they did not owe.
          // Caught on staging: June 1–9 read as 9 days, not 8.
          const counted = countableDates(
            datesBetween(u.startDate.toISOString().slice(0, 10), u.endDate.toISOString().slice(0, 10)),
            beforeOpts,
          );
          const n = u.halfDay
            ? (counted.length > 0 ? (pol.countHalfDays ? 0.5 : 1) : 0)
            : counted.length;
          usedByType.set(key, (usedByType.get(key) ?? 0) + n);
        }

        // Somebody who joined partway through the year gets a pro-rata quota,
        // or their first month reads as an overrun.
        const joined = joinedOn.get(id) ?? null;
        const monthsWorked = joined && joined.getUTCFullYear() === year ? 12 - joined.getUTCMonth() : 12;

        const balances = new Map<string, LeaveBalanceIn>();
        for (const t of types) {
          const alloc = allocations.find((a) => a.teacherId === id && a.typeDefId === t.id);
          const annual = row.kind === 'STAFF' ? t.defaultAnnualStaff : t.defaultAnnual;
          const allotted = alloc ? alloc.allotted + alloc.carriedIn : proRataAllotment(annual, monthsWorked);
          balances.set(t.id, { typeId: t.id, allotted, usedBefore: usedByType.get(t.id) ?? 0 });
        }

        const r = computeLop(row.days, rules, balances, opts);
        warnings.push(...r.warnings.map((w) => `${nameOf.get(id) ?? 'Someone'}: ${w}`));
        if (r.lopDays === 0) continue;

        proposals.push({
          personKind: row.kind,
          personId: id,
          name: nameOf.get(id) ?? 'Someone',
          lopDays: r.lopDays,
          lopWholeDays: r.lopWholeDays,
          lopHalfDays: r.lopHalfDays,
          reasons: r.lines.filter((l) => l.daysUnpaid > 0).map((l) => l.reason),
          anchorApplicationId: (r.lines.find((l) => l.daysUnpaid > 0) ?? r.lines[0]).applicationId,
          applied: appliedFor.has(id),
          clamped: r.lopDays >= daysInMonth,
        });
      }

      for (const p of pending) {
        const who = (p.staffId ?? p.teacherId)!;
        warnings.push(`${nameOf.get(who) ?? 'Someone'} has leave still waiting on a decision — it is left out of this month.`);
      }

      proposals.sort((a, b) => a.name.localeCompare(b.name));
      return {
        basis: pol.basis, countHalfDays: pol.countHalfDays, daysInMonth,
        workingDays: workingDaysIn(year, month, pol.workingDays, pol.holidays),
        proposals, warnings,
        locked: run?.status === 'LOCKED' || run?.status === 'PAID',
      };
    });
  }

  /**
   * Write the chosen proposals in as ordinary adjustments.
   *
   * Ordinary on purpose: the run, the payslip, the register and the bank file
   * already understand `PayAdjustment`, so nothing downstream learns a new
   * shape. `leaveApplicationId` is what marks a line as proposed rather than
   * typed, and what stops the same leave being charged twice.
   */
  async apply(schoolId: string, actorId: string, year: number, month: number, personIds: string[]) {
    if (personIds.length === 0) throw new ApiError('VALIDATION', 'Nobody was chosen.', 400, 'personIds');
    const { proposals, locked } = await this.month(schoolId, year, month);
    if (locked) {
      throw new ApiError(
        'PAY_RUN_LOCKED',
        'That month is locked. A leave decided after the lock belongs in the next month — open it and apply there.',
        409,
      );
    }
    const chosen = proposals.filter((p) => personIds.includes(p.personId) && !p.applied);
    if (chosen.length === 0) return { applied: 0 };

    return withTenant(schoolId, async (tx) => {
      await tx.payAdjustment.createMany({
        data: chosen.map((p) => ({
          schoolId,
          personKind: p.personKind,
          teacherId: p.personKind === 'TEACHER' ? p.personId : null,
          staffId: p.personKind === 'STAFF' ? p.personId : null,
          periodYear: year,
          periodMonth: month,
          label: 'Leave without pay',
          kind: 'DEDUCTION' as const,
          amountMinor: 0,
          taxable: false,
          lopDays: p.lopWholeDays,
          lopHalfDays: p.lopHalfDays,
          note: p.reasons.join('; '),
          // Marks the line as proposed rather than typed, and is what a second
          // call reads to know this person's leave has already been charged.
          // Null here would have left `applied` false forever and allowed the
          // same days to be deducted twice.
          leaveApplicationId: p.anchorApplicationId,
          createdById: actorId,
        })),
      });
      return { applied: chosen.length };
    });
  }

  /** A person's own balance, for the screen that shows it before they apply. */
  async balanceFor(schoolId: string, kind: 'TEACHER' | 'STAFF', personId: string, year: number) {
    return withTenant(schoolId, async (tx) => {
      const [types, used] = await Promise.all([
        tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, isActive: true }, orderBy: { name: 'asc' } }),
        tx.leaveApplication.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: {
            schoolId, status: 'APPROVED',
            ...(kind === 'TEACHER' ? { teacherId: personId } : { staffId: personId }),
            startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
          },
          select: { typeDefId: true, type: true, startDate: true, endDate: true, halfDay: true },
        }),
      ]);
      const usedByType = new Map<string, number>();
      for (const u of used) {
        const key = u.typeDefId ?? u.type;
        const n = u.halfDay ? 0.5 : datesInMonth(
          u.startDate.toISOString().slice(0, 10), u.endDate.toISOString().slice(0, 10),
          u.startDate.getUTCFullYear(), u.startDate.getUTCMonth() + 1,
        ).length;
        usedByType.set(key, (usedByType.get(key) ?? 0) + n);
      }
      return types.map((t) => {
        const allotted = kind === 'STAFF' ? t.defaultAnnualStaff : t.defaultAnnual;
        const u = usedByType.get(t.id) ?? 0;
        return {
          typeId: t.id, name: t.name, isPaid: t.isPaid, neverDeduct: t.neverDeduct,
          allotted, used: u, left: Math.max(0, allotted - u),
          usedLabel: fmt(u),
        };
      });
    });
  }
}
