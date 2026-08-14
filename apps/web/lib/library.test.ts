import { describe, expect, it } from 'vitest';
import { backByLabel, rupees, shelfLabel, stateLabel, toneFor } from './library';

describe('library labels', () => {
  describe('stateLabel', () => {
    it('never produces a bare "Late"', () => {
      // `Late` is already a standalone attendance chip meaning "arrived late to
      // class". A child seeing it on a library row would reasonably read it as
      // a mark against their attendance. The count is what disambiguates, so
      // the number must always be attached.
      for (const d of [-1, -3, -60, 0, 1, 5, 400]) {
        const label = stateLabel(d);
        expect(label.trim().toLowerCase()).not.toBe('late');
        if (label.includes('late')) expect(label).toMatch(/^\d+ days? late$/);
      }
    });

    it('reads in plain words, not library jargon', () => {
      expect(stateLabel(3)).toBe('3 days left');
      expect(stateLabel(1)).toBe('1 day left');
      expect(stateLabel(0)).toBe('back today');
      expect(stateLabel(-1)).toBe('1 day late');
      expect(stateLabel(-6)).toBe('6 days late');
      // No "overdue" anywhere — the spec bans it at the counter.
      expect(stateLabel(-6)).not.toMatch(/overdue|due/i);
    });
  });

  describe('toneFor', () => {
    it('turns amber only in the last two days, red only once late', () => {
      expect(toneFor(10)).toBe('calm');
      expect(toneFor(3)).toBe('calm');
      expect(toneFor(2)).toBe('soon');
      expect(toneFor(0)).toBe('soon');
      expect(toneFor(-1)).toBe('late');
    });
  });

  describe('shelfLabel', () => {
    it('says how many of how many, because availability is counted', () => {
      expect(shelfLabel(2, 3)).toBe('2 of 3 on the shelf');
    });

    it('says plainly when there is none, rather than "0 of 3"', () => {
      // "0 of 3 on the shelf" makes a child read the 3 and walk to the shelf.
      expect(shelfLabel(0, 3)).toBe('all out');
      expect(shelfLabel(0, 1)).toBe('not on the shelf');
    });
  });

  it('formats rupees with Indian grouping', () => {
    expect(rupees(6)).toBe('₹6');
    expect(rupees(1250)).toBe('₹1,250');
    expect(rupees(100000)).toBe('₹1,00,000');
  });

  it('says "back by", never "due"', () => {
    const label = backByLabel('2026-08-26T00:00:00.000Z');
    expect(label).toMatch(/^back by /);
    expect(label).not.toMatch(/due/i);
  });
});
