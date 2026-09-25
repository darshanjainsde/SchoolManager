/**
 * LEAVE THAT REACHES PAY.
 *
 * Pure: no Prisma, no dates beyond `YYYY-MM-DD` strings, no money. It answers
 * one question — how many days of a month go unpaid, and why — and hands back
 * a sentence for each so nothing a school is charged is unexplainable.
 *
 * It deliberately does NOT compute rupees. The pay engine already prorates
 * every line by `daysPaid / daysInMonth`, which is what makes provident fund
 * and ESI follow a short month correctly. Producing a money figure here would
 * be a second, disagreeing answer.
 *
 * The rules, in the order they are applied:
 *
 *   1. A type marked `neverDeduct` costs nothing, whatever the balance says.
 *      Maternity is 26 weeks by law; a school that deducted for it would be
 *      breaking that law through our arithmetic.
 *   2. An UNPAID type always costs, and consumes no balance — that is what
 *      makes it unpaid.
 *   3. A PAID type costs only for the days past what the person was allotted,
 *      counting what they had already used earlier in the same year.
 *   4. Under WORKING_DAY, a day the school does not work is free AND consumes
 *      no balance. Under CALENDAR_DAY a Sunday costs the same as a Tuesday.
 *   5. Under WARN_ONLY nothing is deducted; the overrun is still reported, so
 *      the office can decide case by case.
 */

/** What one day of unpaid leave costs. Mirrors the `LopBasis` enum. */
export type LopBasis = 'CALENDAR_DAY' | 'WORKING_DAY' | 'WARN_ONLY';

export interface LeaveTypeRule {
  id: string;
  name: string;
  /** A paid type deducts only past its quota; an unpaid one always deducts. */
  isPaid: boolean;
  /** Never deducts either way — maternity, bereavement. */
  neverDeduct: boolean;
}

/** One approved application, already clipped to the month being computed. */
export interface LeaveDaysIn {
  applicationId: string;
  typeId: string;
  /** The dates INSIDE this month. A leave spanning two months arrives split. */
  dates: string[];
  /** A single date taken at half strength. */
  halfDay: boolean;
}

/** What this person was given for the year, and what they had already used. */
export interface LeaveBalanceIn {
  typeId: string;
  /** Allotted plus anything carried in from last year. */
  allotted: number;
  /** Days of this type already used EARLIER in the year, before this month. */
  usedBefore: number;
}

export interface LopOptions {
  basis: LopBasis;
  /** Half a day of leave costs half a day of pay. */
  countHalfDays: boolean;
  /** ISO weekdays the school works, 1=Mon … 7=Sun. */
  workingDays: number[];
  /** `YYYY-MM-DD` dates the school is closed — holidays, in this month. */
  holidays?: string[];
}

export interface LopLine {
  applicationId: string;
  typeId: string;
  typeName: string;
  /** Days of this application that fall in the month and count at all. */
  daysTaken: number;
  /** Of those, the days that go unpaid. */
  daysUnpaid: number;
  /** The sentence a person reads beside the deduction. */
  reason: string;
}

export interface LopResult {
  /** Total unpaid days, possibly ending in .5. */
  lopDays: number;
  /** The same figure as whole days plus a half, for integer storage. */
  lopWholeDays: number;
  lopHalfDays: number;
  lines: LopLine[];
  /** Overruns that were NOT deducted, because the school chose warn-only. */
  warnings: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
/** 2 → "2", 2.5 → "2½" — a school writes a half day, not a decimal. */
export function fmt(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

function isoWeekday(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * Which of an application's dates count, under this school's basis.
 *
 * Under WORKING_DAY a Sunday or a declared holiday is free — and, just as
 * importantly, consumes no balance. A school that charged a Sunday against a
 * casual-leave quota would have people "overrun" without missing a working day.
 */
export function countableDates(dates: string[], opts: LopOptions): string[] {
  if (opts.basis !== 'WORKING_DAY') return dates;
  const holidays = new Set(opts.holidays ?? []);
  const works = new Set(opts.workingDays);
  return dates.filter((d) => works.has(isoWeekday(d)) && !holidays.has(d));
}

/**
 * Pro-rata entitlement for somebody who did not work the whole year.
 *
 * Rounded UP, on purpose: a joiner who is short by a fraction of a day should
 * not appear to have overrun in their first month, which is the one month
 * nobody is watching their balance.
 */
export function proRataAllotment(annual: number, monthsWorked: number): number {
  if (monthsWorked >= 12) return annual;
  if (monthsWorked <= 0) return 0;
  return Math.ceil((annual * monthsWorked) / 12);
}

/**
 * How much of this month goes unpaid.
 *
 * `days` arrive already clipped to the month, so a leave from 28 September to
 * 3 October is three days in September's call and three in October's — never
 * six in one. Splitting is the caller's job because only the caller knows
 * which month it is computing.
 */
export function computeLop(
  days: LeaveDaysIn[],
  rules: Map<string, LeaveTypeRule>,
  balances: Map<string, LeaveBalanceIn>,
  opts: LopOptions,
): LopResult {
  const lines: LopLine[] = [];
  const warnings: string[] = [];

  // Days already consumed within THIS month, per type, so a second
  // application in the same month is charged against what the first used.
  const usedThisMonth = new Map<string, number>();

  // Oldest first, so the earlier application keeps the free days. Any stable
  // order would be defensible; this is the one a person expects.
  const ordered = [...days].sort((a, b) => (a.dates[0] ?? '').localeCompare(b.dates[0] ?? ''));

  for (const app of ordered) {
    const rule = rules.get(app.typeId);
    const counted = countableDates(app.dates, opts);
    const unit = app.halfDay && opts.countHalfDays ? 0.5 : 1;
    const taken = app.halfDay ? (counted.length > 0 ? unit : 0) : counted.length;

    if (taken === 0) continue;

    const typeName = rule?.name ?? 'Leave';
    const push = (daysUnpaid: number, reason: string) =>
      lines.push({ applicationId: app.applicationId, typeId: app.typeId, typeName, daysTaken: taken, daysUnpaid, reason });

    // 1. Never deducts, whatever the balance says.
    if (rule?.neverDeduct) {
      push(0, `${typeName}, ${plural(taken, 'day')} — never deducts`);
      continue;
    }

    // 2. An unpaid type always costs, and consumes no balance.
    if (rule && !rule.isPaid) {
      if (opts.basis === 'WARN_ONLY') {
        warnings.push(`${typeName}, ${plural(taken, 'day')} — unpaid, but the school deducts nothing automatically`);
        push(0, `${typeName}, ${plural(taken, 'day')} — not deducted (warn only)`);
        continue;
      }
      push(taken, `${typeName}, ${plural(taken, 'day')} — always deducts`);
      continue;
    }

    // 3. A paid type costs only past its quota.
    const bal = balances.get(app.typeId);
    const allotted = bal?.allotted ?? 0;
    const before = (bal?.usedBefore ?? 0) + (usedThisMonth.get(app.typeId) ?? 0);
    const left = Math.max(0, allotted - before);
    const over = Math.max(0, taken - left);
    usedThisMonth.set(app.typeId, (usedThisMonth.get(app.typeId) ?? 0) + taken);

    if (over === 0) {
      push(0, `${typeName}, ${plural(taken, 'day')} — within the ${allotted} allowed`);
      continue;
    }

    const usedTotal = before + taken;
    const sentence = `${typeName} ${fmt(usedTotal)} of ${allotted} used → ${plural(over, 'day')} over`;
    if (opts.basis === 'WARN_ONLY') {
      warnings.push(sentence);
      push(0, `${sentence} — not deducted (warn only)`);
      continue;
    }
    push(over, sentence);
  }

  const lopDays = lines.reduce((a, l) => a + l.daysUnpaid, 0);
  const lopWholeDays = Math.floor(lopDays);
  return {
    lopDays,
    lopWholeDays,
    lopHalfDays: lopDays - lopWholeDays >= 0.5 ? 1 : 0,
    lines,
    warnings,
  };
}

/**
 * Days paid, given the month's length and what went unpaid.
 *
 * Clamped at zero: a deduction larger than the month is a conversation, not a
 * negative payslip. The caller is told so it can say something rather than
 * quietly paying nothing.
 */
export function daysPaidFor(daysInMonth: number, lopDays: number): { daysPaid: number; clamped: boolean } {
  const paid = daysInMonth - lopDays;
  return paid < 0 ? { daysPaid: 0, clamped: true } : { daysPaid: paid, clamped: false };
}

/** How many of a month's dates the school actually works. */
export function workingDaysIn(year: number, month: number, workingDays: number[], holidays: string[] = []): number {
  const works = new Set(workingDays);
  const hol = new Set(holidays);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d += 1) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (works.has(isoWeekday(iso)) && !hol.has(iso)) n += 1;
  }
  return n;
}

/** Every date from `startISO` to `endISO`, inclusive. */
export function datesBetween(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  if (startISO > endISO) return out;
  let cur = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`).getTime();
  while (cur.getTime() <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return out;
}

/**
 * The dates of one leave application that fall inside one month.
 *
 * This is what stops a leave spanning a month boundary being charged twice:
 * September's run asks for September's slice, October's for October's.
 */
export function datesInMonth(startISO: string, endISO: string, year: number, month: number): string[] {
  const out: string[] = [];
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const from = startISO > first ? startISO : first;
  const to = endISO < last ? endISO : last;
  if (from > to) return out;
  let cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`).getTime();
  while (cur.getTime() <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return out;
}
