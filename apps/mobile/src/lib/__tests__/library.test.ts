import { dueChipLabel, dueTone, fmtDay, ribbonPct, rupees } from '../library';

describe('library display math', () => {
  it('tone: green with time, amber inside 3 days, red overdue', () => {
    expect(dueTone(12)).toBe('green');
    expect(dueTone(4)).toBe('green');
    expect(dueTone(3)).toBe('amber');
    expect(dueTone(0)).toBe('amber');
    expect(dueTone(-1)).toBe('red');
  });

  it('ribbon drains with time and never vanishes or overflows', () => {
    expect(ribbonPct(14, 14)).toBe(86);
    expect(ribbonPct(7, 14)).toBe(43);
    expect(ribbonPct(0, 14)).toBe(8);
    expect(ribbonPct(-5, 14)).toBe(8);
    // A zero loanDays setting must not divide by zero.
    expect(ribbonPct(1, 0)).toBe(86);
  });

  it('the chip carries the words, fines included', () => {
    expect(dueChipLabel(12, '2026-08-30', 0)).toBe('12 days left');
    expect(dueChipLabel(2, '2026-08-19', 0)).toBe('2 days left — due 19 Aug');
    expect(dueChipLabel(1, '2026-08-18', 0)).toBe('1 day left — due 18 Aug');
    expect(dueChipLabel(0, '2026-08-17', 0)).toBe('due today!');
    expect(dueChipLabel(-1, '2026-08-16', 0)).toBe('1 day late');
    expect(dueChipLabel(-3, '2026-08-14', 10)).toBe('3 days late · ₹10 so far');
  });

  it('formats calendar days without the device timezone shifting them', () => {
    expect(fmtDay('2026-08-30')).toBe('30 Aug');
    expect(fmtDay('2027-01-08')).toBe('8 Jan');
  });

  it('rupees uses Indian grouping', () => {
    expect(rupees(120)).toBe('₹120');
    expect(rupees(125000)).toBe('₹1,25,000');
  });
});
