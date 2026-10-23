import { addDays, canMove, ladderOf, phoneKey, promoterCode, rewardMinor, schoolKey, suggestedPct, tdsMinor } from './referral-rules';

describe('Refer & Earn rules', () => {
  it('schoolKey: one key for the many ways a school name gets typed', () => {
    expect(schoolKey("St. Mary's  Convent ", 'Jaipur')).toBe('st marys convent|jaipur');
    expect(schoolKey('ST MARYS CONVENT', ' jaipur')).toBe('st marys convent|jaipur');
    expect(schoolKey('Beacon Public School', 'Ajmer')).not.toBe(schoolKey('Beacon Public School', 'Jaipur'));
  });

  it('phoneKey: the last ten digits, however the number was written', () => {
    for (const v of ['+91 98765 43210', '09876543210', '9876543210', '98765-43210', '(+91) 98765 43210']) expect(phoneKey(v)).toBe('9876543210');
    expect(phoneKey('12345')).toBe('12345'); // too short to match anything; the DTO refuses it anyway
  });

  it('promoterCode: first name letters plus two digits, never empty, never a symbol', () => {
    expect(promoterCode('Rahul Mehta', 42)).toBe('RAHUL52');
    expect(promoterCode('  priya', 0)).toBe('PRIYA10');
    expect(promoterCode('123', 5)).toBe('SK15');
    expect(promoterCode('Krishnamurthy S', 7)).toBe('KRISHN17');
  });

  it('canMove: forward only; nothing leaves a terminal stage; the money stages are not set by hand', () => {
    expect(canMove('LOGGED', 'ACCEPTED')).toBe(true);
    expect(canMove('ACCEPTED', 'DEMO_DONE')).toBe(true);
    expect(canMove('DEMO_DONE', 'CONTACTED')).toBe(false);
    expect(canMove('WON', 'LIVE')).toBe(true);
    expect(canMove('WON', 'PAYOUT_DUE')).toBe(false);
    expect(canMove('LIVE', 'PAID')).toBe(false);
    expect(canMove('CONTACTED', 'LOST')).toBe(true);
    expect(canMove('LOGGED', 'REJECTED')).toBe(true);
    expect(canMove('PAID', 'LOST')).toBe(false);
    expect(canMove('REJECTED', 'ACCEPTED')).toBe(false);
  });

  it('rewardMinor: pct of the invoice, capped, never negative', () => {
    expect(rewardMinor(1_249_500_00, 10, 50_000_00)).toBe(50_000_00); // ₹12.5L × 10% = ₹1.25L → capped at ₹50k
    expect(rewardMinor(3_00_000_00, 10, 50_000_00)).toBe(30_000_00);
    expect(rewardMinor(3_00_000_00, 10, null)).toBe(30_000_00);
    expect(rewardMinor(3_00_000_00, 10, 0)).toBe(30_000_00);
    expect(rewardMinor(0, 10, 50_000_00)).toBe(0);
    expect(rewardMinor(-5, 10, 50_000_00)).toBe(0);
    expect(rewardMinor(1000, 0, null)).toBe(0);
    expect(rewardMinor(333, 10, null)).toBe(33);
  });

  it('tdsMinor: a whole-percent deduction, rounded to the paisa', () => {
    expect(tdsMinor(50_000_00, 2)).toBe(1_000_00);
    expect(tdsMinor(50_000_00, 0)).toBe(0);
    expect(tdsMinor(0, 2)).toBe(0);
  });

  it('ladderOf and suggestedPct: the stored JSON, or the default when it is not ours', () => {
    expect(ladderOf(null)).toEqual({ '1-2': 8, '3-5': 10, '6-10': 12, '10+': 15 });
    expect(ladderOf({ '3-5': 11, junk: 99, '10+': 200 })).toEqual({ '1-2': 8, '3-5': 11, '6-10': 12, '10+': 15 });
    expect(suggestedPct({ '3-5': 11 }, '3-5')).toBe(11);
    expect(suggestedPct({ '3-5': 11 }, '6-10')).toBeNull();
    expect(suggestedPct('nope', '3-5')).toBeNull();
    expect(suggestedPct({ '3-5': 11 }, null)).toBeNull();
  });

  it('addDays', () => {
    expect(addDays(new Date('2026-10-23T00:00:00Z'), 90).toISOString()).toBe('2027-01-21T00:00:00.000Z');
  });
});
