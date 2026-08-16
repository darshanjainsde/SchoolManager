import {
  accruedFineRupees,
  addDaysISO,
  dateOnlyISO,
  diffDays,
  dueOnFor,
  finesApply,
  lateDays,
  loanLimitFor,
  nextAccessionNo,
  type LibraryRules,
} from './library-policy';

const RULES: LibraryRules = {
  studentLoanLimit: 2,
  teacherLoanLimit: 5,
  loanDays: 14,
  finePerDayRupees: 5,
  graceDays: 1,
  lostFeeRupees: 120,
  fineTeachers: false,
};

describe('library policy math', () => {
  it('dates: dateOnly/addDays/diff behave on calendar days', () => {
    expect(dateOnlyISO(new Date('2026-08-16T00:00:00.000Z'))).toBe('2026-08-16');
    expect(addDaysISO('2026-08-16', 14)).toBe('2026-08-30');
    expect(addDaysISO('2026-08-30', -14)).toBe('2026-08-16');
    // Month/year roll
    expect(addDaysISO('2026-12-25', 14)).toBe('2027-01-08');
    expect(diffDays('2026-08-16', '2026-08-30')).toBe(14);
    expect(diffDays('2026-08-30', '2026-08-16')).toBe(-14);
  });

  it('dueOnFor = issue day + loanDays', () => {
    expect(dueOnFor(RULES, '2026-08-16')).toBe('2026-08-30');
  });

  it('limits: per borrower kind', () => {
    expect(loanLimitFor(RULES, 'STUDENT')).toBe(2);
    expect(loanLimitFor(RULES, 'TEACHER')).toBe(5);
  });

  it('lateDays is 0 on/before the due date', () => {
    expect(lateDays('2026-08-30', '2026-08-16')).toBe(0);
    expect(lateDays('2026-08-30', '2026-08-30')).toBe(0);
    expect(lateDays('2026-08-30', '2026-09-02')).toBe(3);
  });

  it('grace boundary: no fine within grace, fine starts the day after', () => {
    // 1 day late, 1 grace day → nothing
    expect(accruedFineRupees(RULES, 'STUDENT', '2026-08-30', '2026-08-31')).toBe(0);
    // 2 days late → (2-1) × ₹5
    expect(accruedFineRupees(RULES, 'STUDENT', '2026-08-30', '2026-09-01')).toBe(5);
    // 12 days late → 11 × ₹5
    expect(accruedFineRupees(RULES, 'STUDENT', '2026-08-30', '2026-09-11')).toBe(55);
  });

  it('teacher fines: zero while off, real while on — late or otherwise', () => {
    expect(finesApply(RULES, 'TEACHER')).toBe(false);
    expect(accruedFineRupees(RULES, 'TEACHER', '2026-08-01', '2026-09-01')).toBe(0);
    const on = { ...RULES, fineTeachers: true };
    expect(finesApply(on, 'TEACHER')).toBe(true);
    expect(accruedFineRupees(on, 'TEACHER', '2026-08-30', '2026-09-01')).toBe(5);
  });

  it('never a negative fine, and ₹0/day means no fine ever', () => {
    expect(accruedFineRupees(RULES, 'STUDENT', '2026-09-30', '2026-08-16')).toBe(0);
    const free = { ...RULES, finePerDayRupees: 0 };
    expect(accruedFineRupees(free, 'STUDENT', '2026-08-01', '2026-09-01')).toBe(0);
  });

  it('accession numbers: first, next, and the width-growth edge', () => {
    expect(nextAccessionNo(null)).toBe('B-00001');
    expect(nextAccessionNo('B-00041')).toBe('B-00042');
    expect(nextAccessionNo('B-99999')).toBe('B-100000');
    // Garbage in the column never breaks allocation
    expect(nextAccessionNo('X-1')).toBe('B-00001');
  });
});
