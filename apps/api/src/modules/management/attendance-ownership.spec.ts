const txMock = {
  classSection: { findFirst: jest.fn(), findMany: jest.fn() },
  student: { findMany: jest.fn() },
  attendance: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  substitution: { findMany: jest.fn(), findFirst: jest.fn() },
  registerChangeRequest: { findFirst: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { AttendanceService } from './attendance.service';
import { istTodayISO } from './internal/timetable-date';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AuditService } from '../../common/audit/audit.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER_USER = 'user-teacher-1';
const TEACHER_ID = 'teacher-1';
const MINE = 'section-mine';
const NOT_MINE = 'section-not-mine';

const today = () => istTodayISO();

describe('AttendanceService ownership', () => {
  const notifications = { notify: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new AttendanceService(
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_ID });
    txMock.classSection.findFirst.mockResolvedValue({ id: NOT_MINE });
    txMock.student.findMany.mockResolvedValue([{ id: 'stu-1' }]);
    txMock.attendance.findMany.mockResolvedValue([]);
    txMock.attendance.deleteMany.mockResolvedValue({ count: 0 });
    txMock.attendance.createMany.mockResolvedValue({ count: 1 });
    txMock.substitution.findMany.mockResolvedValue([]);
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
  });

  const dto = (classSectionId: string, date = today()) => ({
    classSectionId,
    date,
    marks: [{ studentId: 'stu-1', status: 'PRESENT' as const }],
  });

  it('rejects a save for a section the teacher neither owns nor covers', async () => {
    // Not the class teacher, holds no slot, has no substitution today.
    // First `classSection.findFirst` call is `save`'s section-exists check;
    // the second is `requireClassAccess`'s ownership (class teacher / slot)
    // check — distinct queries that must be mocked distinctly here.
    txMock.classSection.findFirst
      .mockResolvedValueOnce({ id: NOT_MINE })
      .mockResolvedValueOnce(null);
    txMock.classSection.findMany.mockResolvedValue([]);

    await expect(svc.save(SCHOOL, TEACHER_USER, dto(NOT_MINE))).rejects.toMatchObject({
      status: 403,
    });
    expect(txMock.attendance.createMany).not.toHaveBeenCalled();
  });

  it('allows a save for a section the teacher owns', async () => {
    txMock.classSection.findMany.mockResolvedValue([
      { id: MINE, name: 'B', grade: { name: '7' }, _count: { students: 1 } },
    ]);
    txMock.classSection.findFirst.mockResolvedValue({ id: MINE });

    const res = await svc.save(SCHOOL, TEACHER_USER, dto(MINE));

    expect(res.saved).toBe(1);
    expect(txMock.attendance.createMany).toHaveBeenCalled();
  });

  it('allows a save for a section the teacher is substituting on that date', async () => {
    txMock.classSection.findMany.mockResolvedValue([]); // not theirs normally
    // First call is `save`'s section-exists check (truthy); second is
    // `requireClassAccess`'s ownership check, which must miss so the
    // substitution grant is actually what lets this save through.
    txMock.classSection.findFirst
      .mockResolvedValueOnce({ id: NOT_MINE })
      .mockResolvedValueOnce(null);
    txMock.substitution.findFirst.mockResolvedValue({ id: 'sub-1' });

    const res = await svc.save(SCHOOL, TEACHER_USER, dto(NOT_MINE));

    expect(res.saved).toBe(1);
    expect(txMock.substitution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classSectionId: NOT_MINE, substituteTeacherId: TEACHER_ID }),
      }),
    );
  });

  it('a SCHOOL_ADMIN may mark any section', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null); // admins usually have no Teacher row
    txMock.classSection.findFirst.mockResolvedValue({ id: NOT_MINE });

    const res = await svc.save(SCHOOL, 'user-admin-1', dto(NOT_MINE), 'SCHOOL_ADMIN');

    expect(res.saved).toBe(1);
  });

  it('myClassSections includes sections covered by substitution today', async () => {
    txMock.classSection.findMany.mockResolvedValueOnce([
      { id: MINE, name: 'B', grade: { name: '7' }, _count: { students: 30 } },
    ]);
    txMock.substitution.findMany.mockResolvedValue([
      { classSectionId: NOT_MINE, substituteTeacherId: TEACHER_ID },
    ]);
    txMock.classSection.findMany.mockResolvedValueOnce([
      { id: NOT_MINE, name: 'A', grade: { name: '9' }, _count: { students: 26 } },
    ]);

    const rows = await svc.myClassSections(SCHOOL, TEACHER_USER, 'TEACHER');

    expect(rows.map((r) => r.classSectionId).sort()).toEqual([MINE, NOT_MINE].sort());
    expect(rows.find((r) => r.classSectionId === NOT_MINE)?.covering).toBe(true);
  });
});
