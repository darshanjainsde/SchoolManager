import { liveSlotWhere } from './timetable-date';

describe('liveSlotWhere — the one "live on this date" rule', () => {
  it('reads the date as an IST day: effectiveFrom <= midnight IST, effectiveTo null or after it', () => {
    const asOf = new Date('2026-10-13T00:00:00+05:30');
    expect(liveSlotWhere('2026-10-13')).toEqual({ effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] });
  });

  it('a malformed date falls back to today in IST rather than matching every version', () => {
    const now = new Date('2026-10-12T20:00:00Z'); // already the 13th in India
    expect(liveSlotWhere('not-a-date', now).effectiveFrom.lte).toEqual(new Date('2026-10-13T00:00:00+05:30'));
  });
});
