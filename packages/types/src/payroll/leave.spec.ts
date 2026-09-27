import {
  computeLop, countableDates, daysPaidFor, datesInMonth, fmt, proRataAllotment, workingDaysIn,
  type LeaveBalanceIn, type LeaveDaysIn, type LeaveTypeRule, type LopOptions,
} from './leave';

const RULES = new Map<string, LeaveTypeRule>([
  ['casual', { id: 'casual', name: 'Casual', isPaid: true, neverDeduct: false }],
  ['sick', { id: 'sick', name: 'Sick', isPaid: true, neverDeduct: false }],
  ['unpaid', { id: 'unpaid', name: 'Unpaid leave', isPaid: false, neverDeduct: false }],
  ['maternity', { id: 'maternity', name: 'Maternity', isPaid: true, neverDeduct: true }],
]);

const bal = (rows: [string, number, number][]) =>
  new Map<string, LeaveBalanceIn>(rows.map(([typeId, allotted, usedBefore]) => [typeId, { typeId, allotted, usedBefore }]));

/** Mon–Sat, the Indian school week. */
const OPTS: LopOptions = { basis: 'CALENDAR_DAY', countHalfDays: true, workingDays: [1, 2, 3, 4, 5, 6] };

const app = (o: Partial<LeaveDaysIn> & { dates: string[] }): LeaveDaysIn => ({
  applicationId: 'a1', typeId: 'casual', halfDay: false, ...o,
});

describe('a paid type costs only past its quota', () => {
  it('is free while there is balance left', () => {
    const r = computeLop([app({ dates: ['2026-10-05', '2026-10-06'] })], RULES, bal([['casual', 12, 3]]), OPTS);
    expect(r.lopDays).toBe(0);
    expect(r.lines[0].reason).toBe('Casual, 2 days — within the 12 allowed');
  });

  it('charges only the days past it, and says the arithmetic out loud', () => {
    // 11 used, 12 allowed, 3 taken → 2 over. A deduction a teacher cannot
    // check is one the office spends a morning defending.
    const r = computeLop(
      [app({ dates: ['2026-10-05', '2026-10-06', '2026-10-07'] })],
      RULES, bal([['casual', 12, 11]]), OPTS,
    );
    expect(r.lopDays).toBe(2);
    expect(r.lines[0].reason).toBe('Casual 14 of 12 used → 2 days over');
  });

  it('counts a second application in the same month against what the first used', () => {
    // Both are "within quota" on their own; together they overrun. Charging
    // each against the OPENING balance would let a month go free twice —
    // 9 used + 2 + 2 = 13 against 12 allowed, so exactly 1 day is over, and
    // it lands on the later application.
    const r = computeLop(
      [
        app({ applicationId: 'a1', dates: ['2026-10-05', '2026-10-06'] }),
        app({ applicationId: 'a2', dates: ['2026-10-20', '2026-10-21'] }),
      ],
      RULES, bal([['casual', 12, 9]]), OPTS,
    );
    expect(r.lopDays).toBe(1);
    expect(r.lines[0].daysUnpaid).toBe(0);
    expect(r.lines[1].daysUnpaid).toBe(1);
    expect(r.lines[1].reason).toBe('Casual 13 of 12 used → 1 day over');
  });

  it('treats no balance row as no quota, rather than as unlimited', () => {
    const r = computeLop([app({ dates: ['2026-10-05'] })], RULES, bal([]), OPTS);
    expect(r.lopDays).toBe(1);
  });
});

describe('the types that do not follow a quota', () => {
  it('unpaid leave always deducts, and consumes no balance', () => {
    const r = computeLop(
      [app({ typeId: 'unpaid', dates: ['2026-10-05', '2026-10-06', '2026-10-07'] })],
      RULES, bal([['unpaid', 0, 0]]), OPTS,
    );
    expect(r.lopDays).toBe(3);
    expect(r.lines[0].reason).toBe('Unpaid leave, 3 days — always deducts');
  });

  it('maternity never deducts, whatever the balance says', () => {
    // 26 weeks is the statutory minimum for a school with ten or more staff.
    // A quota of 12 must not turn the other 170 days into a deduction.
    const dates = datesInMonth('2026-09-01', '2027-02-28', 2026, 10);
    const r = computeLop(
      [app({ typeId: 'maternity', dates })],
      RULES, bal([['maternity', 12, 0]]), OPTS,
    );
    expect(r.lopDays).toBe(0);
    expect(r.lines[0].reason).toMatch(/never deducts/);
  });
});

describe('half days', () => {
  it('cost half a day', () => {
    const r = computeLop(
      [app({ dates: ['2026-10-05'], halfDay: true })],
      RULES, bal([['casual', 0, 0]]), OPTS,
    );
    expect(r.lopDays).toBe(0.5);
    expect(r.lopWholeDays).toBe(0);
    expect(r.lopHalfDays).toBe(1);
  });

  it('cost nothing when the school does not count them', () => {
    const r = computeLop(
      [app({ dates: ['2026-10-05'], halfDay: true })],
      RULES, bal([['casual', 0, 0]]), { ...OPTS, countHalfDays: false },
    );
    expect(r.lopDays).toBe(1);
  });

  it('split into whole and half for integer storage', () => {
    const r = computeLop(
      [
        app({ applicationId: 'a1', typeId: 'unpaid', dates: ['2026-10-05', '2026-10-06'] }),
        app({ applicationId: 'a2', typeId: 'unpaid', dates: ['2026-10-09'], halfDay: true }),
      ],
      RULES, bal([]), OPTS,
    );
    expect(r.lopDays).toBe(2.5);
    expect(r.lopWholeDays).toBe(2);
    expect(r.lopHalfDays).toBe(1);
  });

  it('writes a half the way a school does', () => {
    expect(fmt(2)).toBe('2');
    expect(fmt(2.5)).toBe('2½');
    expect(fmt(0.5)).toBe('½');
  });
});

describe('what a working-day school does not charge for', () => {
  const working: LopOptions = { ...OPTS, basis: 'WORKING_DAY', holidays: ['2026-10-02'] };

  it('a Sunday inside a leave is free, and consumes no balance', () => {
    // 3–5 Oct 2026 is Sat, Sun, Mon. Only Sat and Mon count.
    const r = computeLop(
      [app({ typeId: 'unpaid', dates: ['2026-10-03', '2026-10-04', '2026-10-05'] })],
      RULES, bal([]), working,
    );
    expect(r.lopDays).toBe(2);
    expect(r.lines[0].daysTaken).toBe(2);
  });

  it('a declared holiday is free too', () => {
    const r = computeLop(
      [app({ typeId: 'unpaid', dates: ['2026-10-01', '2026-10-02'] })],
      RULES, bal([]), working,
    );
    expect(r.lopDays).toBe(1);
  });

  it('a leave entirely on non-working days produces no line at all', () => {
    const r = computeLop([app({ typeId: 'unpaid', dates: ['2026-10-04'] })], RULES, bal([]), working);
    expect(r.lines).toEqual([]);
    expect(r.lopDays).toBe(0);
  });

  it('charges the Sunday when the school counts calendar days', () => {
    const r = computeLop(
      [app({ typeId: 'unpaid', dates: ['2026-10-03', '2026-10-04', '2026-10-05'] })],
      RULES, bal([]), OPTS,
    );
    expect(r.lopDays).toBe(3);
  });

  it('counts a month’s working days, minus its holidays', () => {
    // October 2026 has 31 days; 4 Sundays; one declared holiday on a weekday.
    expect(workingDaysIn(2026, 10, [1, 2, 3, 4, 5, 6])).toBe(27);
    expect(workingDaysIn(2026, 10, [1, 2, 3, 4, 5, 6], ['2026-10-02'])).toBe(26);
    expect(workingDaysIn(2026, 10, [1, 2, 3, 4, 5], [])).toBe(22);
  });
});

describe('warn only', () => {
  it('deducts nothing but still reports the overrun', () => {
    // The office decides case by case. Silence would be worse than a warning:
    // the overrun would simply never be noticed.
    const r = computeLop(
      [app({ dates: ['2026-10-05', '2026-10-06', '2026-10-07'] })],
      RULES, bal([['casual', 12, 11]]), { ...OPTS, basis: 'WARN_ONLY' },
    );
    expect(r.lopDays).toBe(0);
    expect(r.warnings).toEqual(['Casual 14 of 12 used → 2 days over']);
  });

  it('does not even deduct unpaid leave, because the school chose not to', () => {
    const r = computeLop(
      [app({ typeId: 'unpaid', dates: ['2026-10-05'] })],
      RULES, bal([]), { ...OPTS, basis: 'WARN_ONLY' },
    );
    expect(r.lopDays).toBe(0);
    expect(r.warnings[0]).toMatch(/deducts nothing automatically/);
  });
});

describe('a leave that crosses a month boundary', () => {
  it('is split by date, never charged twice', () => {
    // 28 Sep – 3 Oct: three days in September, three in October.
    const sep = datesInMonth('2026-09-28', '2026-10-03', 2026, 9);
    const oct = datesInMonth('2026-09-28', '2026-10-03', 2026, 10);
    expect(sep).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
    expect(oct).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);

    const s = computeLop([app({ typeId: 'unpaid', dates: sep })], RULES, bal([]), OPTS);
    const o = computeLop([app({ typeId: 'unpaid', dates: oct })], RULES, bal([]), OPTS);
    expect(s.lopDays).toBe(3);
    expect(o.lopDays).toBe(3);
  });

  it('gives a month nothing when the leave misses it entirely', () => {
    expect(datesInMonth('2026-09-28', '2026-09-30', 2026, 10)).toEqual([]);
  });

  it('clips a leave that swallows a whole month', () => {
    expect(datesInMonth('2026-08-01', '2026-12-31', 2026, 10)).toHaveLength(31);
  });

  it('handles February in a leap year', () => {
    expect(datesInMonth('2028-02-01', '2028-03-05', 2028, 2)).toHaveLength(29);
  });
});

describe('somebody who did not work the whole year', () => {
  it('gets a pro-rata quota, rounded up', () => {
    // Rounded up on purpose: a joiner short by a fraction should not appear to
    // have overrun in the one month nobody is watching their balance.
    expect(proRataAllotment(12, 12)).toBe(12);
    expect(proRataAllotment(12, 6)).toBe(6);
    expect(proRataAllotment(12, 5)).toBe(5);
    expect(proRataAllotment(10, 7)).toBe(6);
    expect(proRataAllotment(12, 0)).toBe(0);
  });

  it('never gets more than the year’s quota', () => {
    expect(proRataAllotment(12, 24)).toBe(12);
  });
});

describe('a deduction bigger than the month', () => {
  it('stops at nothing owed, and says it was clamped', () => {
    // Negative pay is not a thing. The remainder is a conversation.
    expect(daysPaidFor(30, 34)).toEqual({ daysPaid: 0, clamped: true });
    expect(daysPaidFor(30, 30)).toEqual({ daysPaid: 0, clamped: false });
    expect(daysPaidFor(30, 2.5)).toEqual({ daysPaid: 27.5, clamped: false });
  });

  it('a whole month of unpaid leave leaves the person on the payroll', () => {
    const r = computeLop(
      [app({ typeId: 'unpaid', dates: datesInMonth('2026-10-01', '2026-10-31', 2026, 10) })],
      RULES, bal([]), OPTS,
    );
    expect(r.lopDays).toBe(31);
    // Nil pay, but a payslip — a missing payslip reads as a missing person.
    expect(daysPaidFor(31, r.lopDays)).toEqual({ daysPaid: 0, clamped: false });
  });
});

describe('the things that must not blow up', () => {
  it('no leave at all is no deduction, not an error', () => {
    const r = computeLop([], RULES, bal([]), OPTS);
    expect(r).toMatchObject({ lopDays: 0, lopWholeDays: 0, lopHalfDays: 0, lines: [], warnings: [] });
  });

  it('a type the school has since deleted still deducts as unquota’d', () => {
    // The rule is gone but the approved leave is not. Charging it against a
    // quota that no longer exists is the honest reading; crashing is not.
    const r = computeLop([app({ typeId: 'ghost', dates: ['2026-10-05'] })], RULES, bal([]), OPTS);
    expect(r.lopDays).toBe(1);
    expect(r.lines[0].typeName).toBe('Leave');
  });

  it('an application with no dates in this month is ignored', () => {
    const r = computeLop([app({ dates: [] })], RULES, bal([['casual', 0, 0]]), OPTS);
    expect(r.lines).toEqual([]);
  });

  it('countableDates leaves calendar-day schools alone', () => {
    const dates = ['2026-10-03', '2026-10-04'];
    expect(countableDates(dates, OPTS)).toEqual(dates);
  });

  it('is deterministic whatever order the applications arrive in', () => {
    const a = app({ applicationId: 'a1', dates: ['2026-10-05', '2026-10-06'] });
    const b = app({ applicationId: 'a2', dates: ['2026-10-20', '2026-10-21'] });
    const one = computeLop([a, b], RULES, bal([['casual', 12, 9]]), OPTS);
    const two = computeLop([b, a], RULES, bal([['casual', 12, 9]]), OPTS);
    expect(two.lopDays).toBe(one.lopDays);
    expect(two.lines.map((l) => l.applicationId)).toEqual(one.lines.map((l) => l.applicationId));
  });
});
