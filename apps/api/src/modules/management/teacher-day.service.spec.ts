const txMock = {
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  period: { findMany: jest.fn() },
  timetableSlot: { findMany: jest.fn() },
  substitution: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { TeacherDayService } from './teacher-day.service';
import { resolveAsOfDate } from './internal/timetable-date';
import type { AttendanceService } from './attendance.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const TID = 'teacher-1';
const MONDAY = '2026-08-03';

describe('TeacherDayService', () => {
  const attendance = { dayStatus: jest.fn() };
  const svc = new TeacherDayService(attendance as unknown as AttendanceService);

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.period.findMany.mockResolvedValue([
      { id: 'per-1', order: 1, label: 'P1', startTime: '08:00', endTime: '08:45', kind: 'CLASS' },
      { id: 'per-b', order: 2, label: 'Break', startTime: '08:45', endTime: '09:05', kind: 'BREAK' },
      { id: 'per-2', order: 3, label: 'P2', startTime: '09:05', endTime: '09:50', kind: 'CLASS' },
    ]);
    txMock.timetableSlot.findMany.mockResolvedValue([
      {
        periodId: 'per-1',
        classSectionId: 'sec-8c',
        classSection: { id: 'sec-8c', name: 'C', grade: { name: '8' } },
        subject: { name: 'Mathematics' },
        teacherId: TID,
      },
    ]);
    txMock.substitution.findMany.mockResolvedValue([]);
    txMock.teacher.findMany.mockResolvedValue([]);
    attendance.dayStatus.mockResolvedValue([]);
  });

  it('returns every period in order, including breaks', async () => {
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries.map((e) => e.label)).toEqual(['P1', 'Break', 'P2']);
    expect(day.entries[1].kind).toBe('BREAK');
    expect(day.entries[1].slot).toBeNull();
  });

  it('reports the day of week for the requested date', async () => {
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.dayOfWeek).toBe(1);
    expect(day.date).toBe(MONDAY);
  });

  it('attaches the class the teacher teaches in a period', async () => {
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries[0].slot).toMatchObject({
      classSectionId: 'sec-8c',
      className: '8-C',
      subjectName: 'Mathematics',
      covering: false,
    });
  });

  it('leaves a period the teacher does not teach empty', async () => {
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries[2].slot).toBeNull();
  });

  it('adds a covered period, naming the teacher being covered for', async () => {
    txMock.substitution.findMany.mockResolvedValue([
      { periodId: 'per-2', classSectionId: 'sec-9a', substituteTeacherId: TID, originalTeacherId: 'teacher-9' },
    ]);
    txMock.timetableSlot.findMany.mockResolvedValue([
      {
        periodId: 'per-1', classSectionId: 'sec-8c',
        classSection: { id: 'sec-8c', name: 'C', grade: { name: '8' } },
        subject: { name: 'Mathematics' }, teacherId: TID,
      },
      {
        periodId: 'per-2', classSectionId: 'sec-9a',
        classSection: { id: 'sec-9a', name: 'A', grade: { name: '9' } },
        subject: { name: 'Mathematics' }, teacherId: 'teacher-9',
      },
    ]);
    txMock.teacher.findMany.mockResolvedValue([
      { id: 'teacher-9', firstName: 'Ravi', lastName: 'Kumar' },
    ]);

    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);

    expect(day.entries[2].slot).toMatchObject({
      classSectionId: 'sec-9a',
      className: '9-A',
      covering: true,
      coveringFor: 'Ravi Kumar',
    });
  });

  it('merges the register status for each class period', async () => {
    attendance.dayStatus.mockResolvedValue([
      { classSectionId: 'sec-8c', name: '8-C', taken: true, present: 27, total: 28, markedBy: 'Anita Rao', markedAt: null },
    ]);
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries[0].register).toEqual({
      taken: true, present: 27, total: 28, markedBy: 'Anita Rao',
    });
  });

  it('rejects a malformed date', async () => {
    await expect(svc.forTeacher(SCHOOL, USER, 'TEACHER', '03-08-2026')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('keeps the version window AND the ownership filter in the slot query', async () => {
    // Regression guard: both conditions must sit under `AND`. Declaring a
    // second top-level `OR` key replaces the first, which would silently
    // return superseded timetable versions.
    txMock.substitution.findMany.mockResolvedValue([
      { periodId: 'per-2', classSectionId: 'sec-9a', substituteTeacherId: TID, originalTeacherId: 'teacher-9' },
    ]);

    await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);

    const where = txMock.timetableSlot.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR).toEqual([
      { effectiveTo: null },
      { effectiveTo: { gt: resolveAsOfDate(MONDAY, new Date()) } },
    ]);
  });

  it('returns an empty day for a caller with no Teacher row', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries.every((e) => e.slot === null)).toBe(true);
  });
});
