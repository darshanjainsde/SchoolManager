import { buildCells, linesFor, type LineCategory } from './fee-lines';

const CATS: LineCategory[] = [
  { id: 'tuition', name: 'Tuition', description: 'Classroom teaching', frequency: 'PER_TERM', isOptional: false, isCollectible: true },
  { id: 'admission', name: 'Admission', description: 'One-time', frequency: 'ONE_TIME', isOptional: false, isCollectible: true },
  { id: 'annual', name: 'Annual charges', description: 'Lab, library', frequency: 'ANNUAL', isOptional: false, isCollectible: true },
  { id: 'transport', name: 'Transport', description: 'Route 4', frequency: 'PER_TERM', isOptional: true, isCollectible: true },
  { id: 'rte', name: 'RTE reimbursed', description: 'Paid by the state', frequency: 'PER_TERM', isOptional: false, isCollectible: false },
];
const cells = buildCells([
  { gradeId: 'g7', categoryId: 'tuition', termId: null, amountMinor: 1800000 },
  { gradeId: 'g7', categoryId: 'tuition', termId: 't2', amountMinor: 1900000 }, // term-specific wins
  { gradeId: 'g7', categoryId: 'admission', termId: null, amountMinor: 500000 },
  { gradeId: 'g7', categoryId: 'annual', termId: null, amountMinor: 300000 },
  { gradeId: 'g7', categoryId: 'transport', termId: null, amountMinor: 570000 },
  { gradeId: 'g7', categoryId: 'rte', termId: null, amountMinor: 100000 },
]);
const base = { categories: CATS, cells, gradeId: 'g7', optIns: new Set<string>(), isRte: false, concessions: [] as const };

const names = (l: ReturnType<typeof linesFor>) => l.map((x) => `${x.categoryName}:${x.netMinor}`);

describe('linesFor — the one place a child’s fee lines are worked out', () => {
  it('first term, first bill: tuition, admission, annual, rte — transport needs an opt-in', () => {
    expect(names(linesFor({ ...base, termId: 't1', isFirstTerm: true, everBilled: false }))).toEqual([
      'Tuition:1800000', 'Admission:500000', 'Annual charges:300000', 'RTE reimbursed:100000',
    ]);
  });

  it('a later term drops ONE_TIME (already billed once) and ANNUAL (not the first term), and the term-specific cell wins', () => {
    expect(names(linesFor({ ...base, termId: 't2', isFirstTerm: false, everBilled: true }))).toEqual([
      'Tuition:1900000', 'RTE reimbursed:100000',
    ]);
  });

  it('a child joining mid-year still pays admission on their first bill, but not the annual charge', () => {
    expect(names(linesFor({ ...base, termId: 't2', isFirstTerm: false, everBilled: false }))).toEqual([
      'Tuition:1900000', 'Admission:500000', 'RTE reimbursed:100000',
    ]);
  });

  it('an opt-in adds the optional line', () => {
    const l = linesFor({ ...base, termId: 't2', isFirstTerm: false, everBilled: true, optIns: new Set(['transport']) });
    expect(names(l)).toContain('Transport:570000');
  });

  it('concessions stack against what is left, name their reasons, and never go negative', () => {
    const l = linesFor({
      ...base, termId: 't1', isFirstTerm: true, everBilled: false,
      concessions: [
        { categoryId: 'tuition', percentBps: 1000, amountMinor: null, reason: 'Sibling discount' },
        { categoryId: null, percentBps: null, amountMinor: 9_000_000, reason: 'Staff ward' }, // bigger than any line
      ],
    });
    const tuition = l.find((x) => x.categoryId === 'tuition')!;
    expect(tuition.concessionMinor).toBe(1800000); // 10% then the rest — clamped to the line
    expect(tuition.netMinor).toBe(0);
    expect(tuition.concessionReason).toBe('Sibling discount · Staff ward');
    expect(l.every((x) => x.netMinor >= 0)).toBe(true);
  });

  it('an RTE student’s lines are recorded but never collectible', () => {
    const l = linesFor({ ...base, termId: 't1', isFirstTerm: true, everBilled: false, isRte: true });
    expect(l.every((x) => x.isCollectible === false)).toBe(true);
  });

  it('a grade with no cell for a category simply has no line', () => {
    expect(linesFor({ ...base, gradeId: 'g-nursery', termId: 't1', isFirstTerm: true, everBilled: false })).toEqual([]);
  });
});
