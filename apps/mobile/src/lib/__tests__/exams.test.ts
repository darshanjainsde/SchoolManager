import {
  buildResultsPayload,
  isValidMaxMarks,
  markOutOfRange,
  marksValid,
  shiftTime,
  toScheduledAtISO,
} from '../exams';

describe('shiftTime', () => {
  it('steps forward within a day', () => {
    expect(shiftTime('09:00', 15)).toBe('09:15');
  });

  it('steps backward within a day', () => {
    expect(shiftTime('09:00', -15)).toBe('08:45');
  });

  it('wraps forward past midnight', () => {
    expect(shiftTime('23:50', 15)).toBe('00:05');
  });

  it('wraps backward past midnight', () => {
    expect(shiftTime('00:05', -15)).toBe('23:50');
  });
});

describe('toScheduledAtISO', () => {
  it('combines date and time as device-local, not UTC', () => {
    // Local 2026-08-03 14:30 — using a fixed system time only to prove the
    // conversion is NOT routed through toISOString() on the date string,
    // which would silently reinterpret it as UTC.
    const iso = toScheduledAtISO('2026-08-03', '14:30');
    const d = new Date(iso);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August, 0-indexed
    expect(d.getDate()).toBe(3);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });
});

describe('isValidMaxMarks', () => {
  it('accepts a positive integer', () => {
    expect(isValidMaxMarks('100')).toBe(true);
    expect(isValidMaxMarks('1')).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidMaxMarks('0')).toBe(false);
  });

  it('rejects a negative number', () => {
    expect(isValidMaxMarks('-5')).toBe(false);
  });

  it('rejects a non-integer', () => {
    expect(isValidMaxMarks('10.5')).toBe(false);
  });

  it('rejects blank input', () => {
    expect(isValidMaxMarks('')).toBe(false);
    expect(isValidMaxMarks('   ')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidMaxMarks('abc')).toBe(false);
  });
});

const STUDENTS = [
  { id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' },
  { id: 's2', firstName: 'Ben', lastName: 'Lee', rollNo: '2' },
  { id: 's3', firstName: 'Cy', lastName: 'Wu', rollNo: '3' },
];

describe('buildResultsPayload', () => {
  it('keeps a raw string like "07" as its numeric value', () => {
    const payload = buildResultsPayload(STUDENTS, { s1: '07' });
    expect(payload).toEqual([{ studentId: 's1', marks: 7 }]);
  });

  it('drops blank entries entirely — never sends a mark as 0', () => {
    const payload = buildResultsPayload(STUDENTS, { s1: '10', s2: '', s3: '   ' });
    expect(payload).toEqual([{ studentId: 's1', marks: 10 }]);
  });

  it('sends only the rows that were actually entered — a partial save', () => {
    const payload = buildResultsPayload(STUDENTS, { s2: '20' });
    expect(payload).toEqual([{ studentId: 's2', marks: 20 }]);
  });

  it('returns an empty array when nothing is entered', () => {
    expect(buildResultsPayload(STUDENTS, {})).toEqual([]);
  });
});

describe('marksValid', () => {
  it('is false with no entered marks', () => {
    expect(marksValid([], 100)).toBe(false);
  });

  it('is true when every mark is within 0..maxMarks', () => {
    expect(
      marksValid(
        [
          { studentId: 's1', marks: 0 },
          { studentId: 's2', marks: 100 },
        ],
        100,
      ),
    ).toBe(true);
  });

  it('is false when a mark exceeds maxMarks', () => {
    expect(marksValid([{ studentId: 's1', marks: 101 }], 100)).toBe(false);
  });

  it('is false when a mark is negative', () => {
    expect(marksValid([{ studentId: 's1', marks: -1 }], 100)).toBe(false);
  });
});

describe('markOutOfRange', () => {
  it('is false for a blank entry', () => {
    expect(markOutOfRange('', 100)).toBe(false);
  });

  it('is false for an in-range entry', () => {
    expect(markOutOfRange('50', 100)).toBe(false);
  });

  it('is true for a mark over maxMarks', () => {
    expect(markOutOfRange('101', 100)).toBe(true);
  });

  it('is true for a negative mark', () => {
    expect(markOutOfRange('-1', 100)).toBe(true);
  });
});
