import { nextSessionDefaults, gradeLadder, defaultSectionMap, attendancePct, resultsPct, assignRollNumbers } from './session-maths';

describe('session maths', () => {
  it('next session name and dates', () => {
    const n = nextSessionDefaults({ name: '2025-26', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') });
    expect(n.name).toBe('2026-27');
    expect(n.startDate.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(n.endDate.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(nextSessionDefaults({ name: 'Session 2025', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') }).name).toBe('Session 2026');
    // The century wraps in the short half: 2099-00 is what "2098-99 + 1" reads as.
    expect(nextSessionDefaults({ name: '2098-99', startDate: new Date('2098-04-01'), endDate: new Date('2099-03-31') }).name).toBe('2099-00');
  });

  it('grade ladder rejects duplicate orders and an empty catalogue', () => {
    expect(gradeLadder([{ id: 'g2', order: 2 }, { id: 'g1', order: 1 }])).toEqual({ ok: true, ordered: ['g1', 'g2'] });
    expect(gradeLadder([{ id: 'g1', order: 0 }, { id: 'g2', order: 0 }])).toEqual({ ok: false, reason: 'DUPLICATE_ORDER' });
    expect(gradeLadder([])).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('default map: same name in next grade, else first section, top grade passes out', () => {
    const from = [{ id: 'f5a', gradeId: 'g5', name: 'A' }, { id: 'f5c', gradeId: 'g5', name: 'C' }, { id: 'f10a', gradeId: 'g10', name: 'A' }];
    const to = [{ id: 't6a', gradeId: 'g6', name: 'A' }, { id: 't6b', gradeId: 'g6', name: 'B' }, { id: 't10a', gradeId: 'g10', name: 'A' }];
    expect(defaultSectionMap(from, to, ['g5', 'g6', 'g10'])).toEqual({ f5a: 't6a', f5c: 't6a', f10a: 'PASS_OUT' });
  });

  it('default map: a next grade with no sections yet also passes out (Start re-validates)', () => {
    expect(defaultSectionMap([{ id: 'f5a', gradeId: 'g5', name: 'A' }], [], ['g5', 'g6'])).toEqual({ f5a: 'PASS_OUT' });
  });

  it('percentages, and null for "nothing to count"', () => {
    expect(attendancePct([{ status: 'PRESENT' }, { status: 'LATE' }, { status: 'ABSENT' }, { status: 'PRESENT' }])).toBe(75);
    expect(attendancePct([])).toBeNull();
    expect(resultsPct([{ marks: 40, maxMarks: 50 }, { marks: 25, maxMarks: 50 }])).toBe(65);
    expect(resultsPct([])).toBeNull();
    expect(resultsPct([{ marks: 0, maxMarks: 0 }])).toBeNull();
  });

  it('roll numbers', () => {
    const s = [
      { id: 'b', firstName: 'Meera', lastName: 'Iyer', admissionNo: '0102', rollNo: '7' },
      { id: 'a', firstName: 'Aarav', lastName: 'Mehta', admissionNo: '0099', rollNo: '3' },
    ];
    expect([...assignRollNumbers('KEEP', s).entries()]).toEqual([['b', '7'], ['a', '3']]);
    expect([...assignRollNumbers('ALPHABETICAL', s).entries()]).toEqual([['a', '1'], ['b', '2']]);
    expect([...assignRollNumbers('ADMISSION_NO', s).entries()]).toEqual([['a', '1'], ['b', '2']]);
    // Numeric admission numbers sort as numbers, not strings: 10 after 9.
    const n = [
      { id: 'x', firstName: 'A', lastName: 'A', admissionNo: 'ADM-10', rollNo: null },
      { id: 'y', firstName: 'B', lastName: 'B', admissionNo: 'ADM-9', rollNo: null },
    ];
    expect([...assignRollNumbers('ADMISSION_NO', n).entries()]).toEqual([['y', '1'], ['x', '2']]);
  });
});
