const txMock = {
  classSection: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
  school: { findFirst: jest.fn() },
  student: { findMany: jest.fn() },
  attendance: { findMany: jest.fn() },
  attendanceNotice: { findMany: jest.fn(), createMany: jest.fn() },
  notification: { createMany: jest.fn() },
  user: { findMany: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

const backgroundJobs: Array<() => Promise<unknown>> = [];
jest.mock('../../common/notifications/run-in-background', () => ({
  runInBackground: (work: () => Promise<unknown>) => {
    backgroundJobs.push(work);
  },
}));

import { AttendanceBarService, NOTICE_COOLDOWN_DAYS } from './attendance-bar.service';
import type { NotificationService } from '../../common/notifications/notification.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const TID = 'teacher-1';
const SECTION = 'sec-8c';
const FROM = '2026-07-01';
const TO = '2026-08-02';

const AARAV = 'stu-aarav';
const DIYA = 'stu-diya';
const KABIR = 'stu-kabir';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

/** Aarav 50% (1 of 2), Diya 100%, Kabir never marked. */
function threeStudentClass() {
  txMock.student.findMany.mockResolvedValue([
    { id: AARAV, firstName: 'Aarav', lastName: 'Sharma', rollNo: '1' },
    { id: DIYA, firstName: 'Diya', lastName: 'Rao', rollNo: '2' },
    { id: KABIR, firstName: 'Kabir', lastName: 'Nair', rollNo: '3' },
  ]);
  txMock.attendance.findMany.mockResolvedValue([
    { studentId: AARAV, status: 'PRESENT', date: day('2026-07-01') },
    { studentId: AARAV, status: 'ABSENT', date: day('2026-07-02') },
    { studentId: DIYA, status: 'LATE', date: day('2026-07-01') },
    { studentId: DIYA, status: 'PRESENT', date: day('2026-07-02') },
  ]);
}

async function flushBackground() {
  const jobs = backgroundJobs.splice(0);
  for (const job of jobs) await job();
}

describe('AttendanceBarService', () => {
  const notifications = { notify: jest.fn() };
  const svc = new AttendanceBarService(notifications as unknown as NotificationService);

  beforeEach(() => {
    jest.clearAllMocks();
    backgroundJobs.length = 0;
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.classSection.findFirst.mockResolvedValue({
      id: SECTION,
      name: 'C',
      grade: { name: '8' },
    });
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles Public School' });
    txMock.attendanceNotice.findMany.mockResolvedValue([]);
    txMock.attendanceNotice.createMany.mockResolvedValue({ count: 0 });
    txMock.notification.createMany.mockResolvedValue({ count: 0 });
    txMock.user.findMany.mockResolvedValue([]);
    txMock.student.findMany.mockResolvedValue([]);
    txMock.attendance.findMany.mockResolvedValue([]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });
  });

  describe('rates', () => {
    it('ranks lowest first and counts LATE as attended', async () => {
      threeStudentClass();

      const out = await svc.rates(SCHOOL, SECTION, USER, 'TEACHER', { from: FROM, to: TO });

      expect(out.className).toBe('8-C');
      expect(out.daysMarked).toBe(2);
      expect(out.students.map((s) => [s.name, s.percent])).toEqual([
        ['Kabir Nair', 0], // nothing marked yet
        ['Aarav Sharma', 50],
        ['Diya Rao', 100], // LATE counted as in the room
      ]);
    });

    it('a teacher cannot read a class they do not hold', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null); // requireClassAccess: not owned
      txMock.substitution.findFirst.mockResolvedValue(null);

      await expect(
        svc.rates(SCHOOL, SECTION, USER, 'TEACHER', { from: FROM, to: TO }),
      ).rejects.toMatchObject({ response: { code: 'CLASS_NOT_OWNED' } });
    });
  });

  describe('notifyLow', () => {
    const dto = { classSectionId: SECTION, threshold: 75, from: FROM, to: TO };

    it('emails only the families below the benchmark, one child per email', async () => {
      threeStudentClass();

      const out = await svc.notifyLow(SCHOOL, USER, 'TEACHER', dto);

      // Kabir has no marks at all — 0% is an absence of data, not a fact
      // about the child, so his family is not written to.
      expect(out.notified).toBe(1);
      expect(txMock.attendanceNotice.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ studentId: AARAV, percent: 50, threshold: 75 })],
      });

      txMock.student.findMany.mockResolvedValue([
        { userId: 'u1', firstName: 'Aarav', lastName: 'Sharma' },
      ]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u1', email: 'parent@example.com' }]);
      await flushBackground();

      expect(notifications.notify).toHaveBeenCalledWith('LOW_ATTENDANCE', [
        expect.objectContaining({
          email: 'parent@example.com',
          payload: expect.objectContaining({
            studentName: 'Aarav Sharma',
            percent: 50,
            threshold: 75,
          }),
        }),
      ]);
    });

    it('honours the cooldown — a family told this week is skipped, not re-nagged', async () => {
      threeStudentClass();
      txMock.attendanceNotice.findMany.mockResolvedValue([
        { studentId: AARAV, sentAt: daysAgo(2) },
      ]);

      const out = await svc.notifyLow(SCHOOL, USER, 'TEACHER', dto);

      expect(out).toEqual({
        notified: 0,
        skippedInCooldown: 1,
        cooldownDays: NOTICE_COOLDOWN_DAYS,
      });
      expect(txMock.attendanceNotice.createMany).not.toHaveBeenCalled();
      await flushBackground();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('sends again once the cooldown has passed', async () => {
      threeStudentClass();
      txMock.attendanceNotice.findMany.mockResolvedValue([
        { studentId: AARAV, sentAt: daysAgo(NOTICE_COOLDOWN_DAYS + 1) },
      ]);

      const out = await svc.notifyLow(SCHOOL, USER, 'TEACHER', dto);
      expect(out.notified).toBe(1);
      expect(out.skippedInCooldown).toBe(0);
    });

    it('respects the teacher’s final say — only the chosen children are told', async () => {
      threeStudentClass();

      const out = await svc.notifyLow(SCHOOL, USER, 'TEACHER', {
        ...dto,
        threshold: 100,
        studentIds: [DIYA], // Diya is at 100%, so still nobody qualifies
      });

      expect(out.notified).toBe(0);
    });

    it('recomputes server-side rather than trusting the client’s numbers', async () => {
      // The child has since recovered to 100%; a stale slider must not email.
      txMock.student.findMany.mockResolvedValue([
        { id: AARAV, firstName: 'Aarav', lastName: 'Sharma', rollNo: '1' },
      ]);
      txMock.attendance.findMany.mockResolvedValue([
        { studentId: AARAV, status: 'PRESENT', date: day('2026-07-01') },
      ]);

      const out = await svc.notifyLow(SCHOOL, USER, 'TEACHER', { ...dto, studentIds: [AARAV] });

      expect(out.notified).toBe(0);
      expect(txMock.attendanceNotice.createMany).not.toHaveBeenCalled();
    });
  });
});
