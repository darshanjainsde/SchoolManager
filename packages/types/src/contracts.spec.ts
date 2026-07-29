import { ATTENDANCE_STATUSES, type AttendanceStatusValue, type TeacherDayEntry } from './index';

describe('shared portal contracts', () => {
  it('declares exactly the three attendance states the API accepts', () => {
    expect([...ATTENDANCE_STATUSES].sort()).toEqual(['ABSENT', 'LATE', 'PRESENT']);
  });

  it('AttendanceStatusValue admits every declared status and nothing else', () => {
    const ok: AttendanceStatusValue[] = ['PRESENT', 'ABSENT', 'LATE'];
    expect(ok).toHaveLength(3);
    // @ts-expect-error HALF_DAY is not an attendance state
    const bad: AttendanceStatusValue = 'HALF_DAY';
    expect(bad).toBe('HALF_DAY');
  });

  it('a break entry carries no slot and no register', () => {
    const entry: TeacherDayEntry = {
      periodId: 'p', label: 'Lunch', startTime: '11:20', endTime: '12:00',
      kind: 'BREAK', slot: null, register: null,
    };
    expect(entry.slot).toBeNull();
  });
});
