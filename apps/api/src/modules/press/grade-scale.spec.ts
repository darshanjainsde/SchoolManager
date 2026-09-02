import { gradeForPct, pctOf } from './grade-scale';

describe('gradeForPct — the CBSE 8-point scale', () => {
  // Boundaries are inclusive at the bottom of each band. Each pair proves one
  // edge from both sides, because an off-by-one here misgrades a real child on
  // a printed card their family keeps.
  it.each([
    [100, 'A1'], [91, 'A1'], [90, 'A2'], [81, 'A2'], [80, 'B1'], [71, 'B1'],
    [70, 'B2'], [61, 'B2'], [60, 'C1'], [51, 'C1'], [50, 'C2'], [41, 'C2'],
    [40, 'D'], [33, 'D'], [32, 'E'], [0, 'E'],
  ])('%s%% → %s', (pct, grade) => {
    expect(gradeForPct(pct as number)).toBe(grade);
  });

  it('passes null through — no data must never grade as an E', () => {
    expect(gradeForPct(null)).toBeNull();
  });

  it('refuses to grade NaN', () => {
    expect(gradeForPct(Number.NaN)).toBeNull();
  });

  it('clamps out-of-range percentages instead of crashing on them', () => {
    expect(gradeForPct(104)).toBe('A1'); // bonus marks pushed a sum past max
    expect(gradeForPct(-3)).toBe('E');
  });
});

describe('pctOf', () => {
  it('rounds to a whole number', () => {
    expect(pctOf(42, 50)).toBe(84);
    expect(pctOf(1, 3)).toBe(33);
  });

  it('yields null for a zero max — a data-entry accident, not an Infinity', () => {
    expect(pctOf(10, 0)).toBeNull();
  });

  it('yields null for null marks', () => {
    expect(pctOf(null, 100)).toBeNull();
  });
});
