import { computeLateFee, daysLate, describeLateFeeRule, type LateFeeRule } from './late-fee';

const PER_DAY: LateFeeRule = { mode: 'PER_DAY', amountMinor: 10_000, graceDays: 0, capMinor: 100_000 };
const FLAT: LateFeeRule = { mode: 'FLAT', amountMinor: 50_000, graceDays: 0, capMinor: null };
const OFF: LateFeeRule = { mode: 'NONE', amountMinor: 0, graceDays: 0, capMinor: null };

const due = new Date('2026-09-10T00:00:00+05:30');
const on = (iso: string) => new Date(`${iso}T12:00:00+05:30`);

const base = { dueDate: due, outstandingMinor: 1_000_000, isCollectible: true };

describe('daysLate', () => {
  it('is zero on the due date itself', () => {
    expect(daysLate(due, on('2026-09-10'))).toBe(0);
  });

  it('is zero before the due date', () => {
    expect(daysLate(due, on('2026-09-01'))).toBe(0);
  });

  it('counts whole days after', () => {
    expect(daysLate(due, on('2026-09-11'))).toBe(1);
    expect(daysLate(due, on('2026-09-16'))).toBe(6);
  });

  it('uses the school’s timezone, not the server’s', () => {
    // 23:30 IST on the due date is still the due date, even though it is
    // already the 10th in UTC by a wide margin — and 00:30 IST the next day is
    // one day late, though in UTC it is still the 10th.
    expect(daysLate(due, new Date('2026-09-10T23:30:00+05:30'))).toBe(0);
    expect(daysLate(due, new Date('2026-09-11T00:30:00+05:30'))).toBe(1);
  });
});

describe('computeLateFee', () => {
  it('charges nothing when the school has it switched off', () => {
    expect(computeLateFee({ ...base, rule: OFF, asOf: on('2026-12-31') })).toBe(0);
  });

  it('charges nothing on or before the due date', () => {
    expect(computeLateFee({ ...base, rule: PER_DAY, asOf: on('2026-09-10') })).toBe(0);
    expect(computeLateFee({ ...base, rule: PER_DAY, asOf: on('2026-09-09') })).toBe(0);
  });

  it('charges per day once late', () => {
    expect(computeLateFee({ ...base, rule: PER_DAY, asOf: on('2026-09-16') })).toBe(60_000);
  });

  it('respects the cap', () => {
    // 60 days at ₹100 would be ₹6,000; the cap is ₹1,000.
    expect(computeLateFee({ ...base, rule: PER_DAY, asOf: on('2026-11-09') })).toBe(100_000);
  });

  it('charges a flat fee once, however late', () => {
    expect(computeLateFee({ ...base, rule: FLAT, asOf: on('2026-09-11') })).toBe(50_000);
    expect(computeLateFee({ ...base, rule: FLAT, asOf: on('2026-12-31') })).toBe(50_000);
  });

  it('waits out the grace days', () => {
    const graced: LateFeeRule = { ...PER_DAY, graceDays: 5 };
    expect(computeLateFee({ ...base, rule: graced, asOf: on('2026-09-15') })).toBe(0);
    expect(computeLateFee({ ...base, rule: graced, asOf: on('2026-09-16') })).toBe(10_000);
  });

  it('charges nothing when nothing is owed', () => {
    expect(computeLateFee({ ...base, outstandingMinor: 0, rule: PER_DAY, asOf: on('2026-10-10') })).toBe(0);
  });

  it('never charges an RTE student', () => {
    // Their fee is reimbursed by the state; they are not a defaulter, so
    // charging them for lateness would be incoherent.
    expect(computeLateFee({ ...base, isCollectible: false, rule: PER_DAY, asOf: on('2026-10-10') })).toBe(0);
  });

  it('never exceeds the debt it is charged on', () => {
    const tiny = { ...base, outstandingMinor: 5_000 };
    expect(computeLateFee({ ...tiny, rule: PER_DAY, asOf: on('2026-09-30') })).toBe(5_000);
  });

  it('is monotonic — it can only grow as time passes', () => {
    let prev = 0;
    for (let d = 10; d <= 90; d++) {
      const asOf = new Date(due.getTime() + (d - 10) * 86_400_000);
      const fee = computeLateFee({ ...base, rule: PER_DAY, asOf });
      expect(fee).toBeGreaterThanOrEqual(prev);
      prev = fee;
    }
  });
});

describe('describeLateFeeRule', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeLateFeeRule(OFF)).toBeNull();
  });

  it('explains a per-day rule with its cap', () => {
    expect(describeLateFeeRule(PER_DAY)).toBe('₹100 per day past the due date, up to ₹1,000');
  });

  it('explains grace days', () => {
    expect(describeLateFeeRule({ ...PER_DAY, graceDays: 1 }))
      .toBe('₹100 per day past the due date after 1 grace day, up to ₹1,000');
  });

  it('explains a flat rule', () => {
    expect(describeLateFeeRule(FLAT)).toBe('₹500 once the due date passes');
  });
});
