const txMock = {
  student: { findFirst: jest.fn() },
  attendance: { findMany: jest.fn() },
  exam: { findMany: jest.fn() },
  result: { findMany: jest.fn(), groupBy: jest.fn() },
  subject: { findMany: jest.fn() },
  mediaAsset: { findFirst: jest.fn() },
  announcement: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
  pushToken: { upsert: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

/** The platform (BYPASSRLS) client — only `pushToken.update` is exercised, for the
 * cross-tenant-token-reassignment path in `registerPushToken`. */
const platformMock = {
  pushToken: { update: jest.fn() },
};

// Keep the real `Prisma` export (prisma-errors.ts's isP2002 relies on
// `instanceof Prisma.PrismaClientKnownRequestError`); only `withTenant` and
// `getPlatformPrisma` are stubbed so no real DB connection is ever attempted.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
  getPlatformPrisma: () => platformMock,
}));

/**
 * `portal.service.ts` imports `TenantContextService` from the tenancy barrel
 * (siblings are only allowed to import from there). The barrel also re-exports
 * `TenancyModule`, whose middleware calls `loadEnv()` at module-load time —
 * which blows up in a unit test with no env. We only ever inject our own stub
 * instance, so a bare class stands in for the real class token.
 */
jest.mock('../tenancy', () => ({
  TenantContextService: class TenantContextService {},
  TenancyModule: class TenancyModule {},
  SchoolLookupService: class SchoolLookupService {},
}));

import { PortalService } from './portal.service';
import type { TenantContextService } from '../tenancy';
import type { TimetableService } from '../management/timetable.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
/** The caller's OWN Student.id — every query must be keyed on this. */
const STUDENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
/** A classmate. Their marks must never appear in a response. */
const OTHER_STUDENT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CLASS_SECTION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const SUBJECT = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** `Attendance.date` is `@db.Date` → Prisma hands back UTC midnight. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('PortalService', () => {
  const tenant = { requireTenant: jest.fn() };
  const timetable = { listForClass: jest.fn() };
  const svc = new PortalService(
    tenant as unknown as TenantContextService,
    timetable as unknown as TimetableService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    tenant.requireTenant.mockReturnValue({
      kind: 'tenant',
      schoolId: SCHOOL,
      hostname: 'green.sckools.com',
      schoolSlug: 'green',
    });
    // The default caller: a real student, in a class section.
    txMock.student.findFirst.mockResolvedValue({
      id: STUDENT,
      userId: USER,
      classSectionId: CLASS_SECTION,
      classSection: { id: CLASS_SECTION, name: '8-A' },
    });
    txMock.subject.findMany.mockResolvedValue([{ id: SUBJECT, name: 'Mathematics' }]);
  });

  // ── attendance ──────────────────────────────────────────────────────────

  describe('attendance', () => {
    it('computes percent from present/(present+absent+late) and returns the day list', async () => {
      txMock.attendance.findMany.mockResolvedValue([
        { date: day('2026-07-01'), status: 'PRESENT' },
        { date: day('2026-07-02'), status: 'PRESENT' },
        { date: day('2026-07-03'), status: 'ABSENT' },
        { date: day('2026-07-06'), status: 'LATE' },
      ]);

      const result = await svc.attendance(USER, '2026-07');

      expect(result).toEqual({
        month: '2026-07',
        // 2 present of 4 marked days.
        percent: 50,
        present: 2,
        absent: 1,
        late: 1,
        days: [
          { date: '2026-07-01', status: 'PRESENT' },
          { date: '2026-07-02', status: 'PRESENT' },
          { date: '2026-07-03', status: 'ABSENT' },
          { date: '2026-07-06', status: 'LATE' },
        ],
      });
    });

    it('rounds the percent rather than truncating it', async () => {
      // 2 of 3 = 66.66…% → 67, not 66.
      txMock.attendance.findMany.mockResolvedValue([
        { date: day('2026-07-01'), status: 'PRESENT' },
        { date: day('2026-07-02'), status: 'PRESENT' },
        { date: day('2026-07-03'), status: 'ABSENT' },
      ]);

      const result = await svc.attendance(USER, '2026-07');

      expect(result.percent).toBe(67);
    });

    it('reports 0% (never NaN) for a month with no marks at all', async () => {
      txMock.attendance.findMany.mockResolvedValue([]);

      const result = await svc.attendance(USER, '2026-07');

      expect(result).toEqual({
        month: '2026-07',
        percent: 0,
        present: 0,
        absent: 0,
        late: 0,
        days: [],
      });
      expect(Number.isNaN(result.percent)).toBe(false);
    });

    it('scopes the query to the CALLER\'S OWN studentId and the requested month only', async () => {
      txMock.attendance.findMany.mockResolvedValue([]);

      await svc.attendance(USER, '2026-07');

      expect(txMock.attendance.findMany).toHaveBeenCalledWith({
        where: {
          schoolId: SCHOOL,
          studentId: STUDENT,
          // Half-open [Jul 1, Aug 1) so the boundary day is counted exactly once.
          date: { gte: new Date(Date.UTC(2026, 6, 1)), lt: new Date(Date.UTC(2026, 7, 1)) },
        },
        orderBy: { date: 'asc' },
        select: { date: true, status: true },
      });
      // …and the student row itself was found by the JWT sub, not a client id.
      expect(txMock.student.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER } }),
      );
    });

    it('spans a December→January boundary correctly', async () => {
      txMock.attendance.findMany.mockResolvedValue([]);

      await svc.attendance(USER, '2026-12');

      expect(txMock.attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: { gte: new Date(Date.UTC(2026, 11, 1)), lt: new Date(Date.UTC(2027, 0, 1)) },
          }),
        }),
      );
    });

    it('defaults to the current IST month when no month is supplied', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
      txMock.attendance.findMany.mockResolvedValue([]);

      const result = await svc.attendance(USER);

      expect(result.month).toBe('2026-07');
      jest.useRealTimers();
    });

    it('defaults to the current IST month when month is an empty or whitespace-only string', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
      txMock.attendance.findMany.mockResolvedValue([]);

      const empty = await svc.attendance(USER, '');
      expect(empty.month).toBe('2026-07');

      const whitespace = await svc.attendance(USER, '   ');
      expect(whitespace.month).toBe('2026-07');

      jest.useRealTimers();
    });

    it('rejects a malformed month with VALIDATION before reading anything', async () => {
      await expect(svc.attendance(USER, 'July 2026')).rejects.toMatchObject({
        response: { code: 'VALIDATION', field: 'month' },
      });
      expect(txMock.attendance.findMany).not.toHaveBeenCalled();
      expect(txMock.student.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range month number with VALIDATION', async () => {
      await expect(svc.attendance(USER, '2026-13')).rejects.toMatchObject({
        response: { code: 'VALIDATION', field: 'month' },
      });
      expect(txMock.attendance.findMany).not.toHaveBeenCalled();
    });

    it('404s when the login has no student record', async () => {
      txMock.student.findFirst.mockResolvedValue(null);

      await expect(svc.attendance(USER, '2026-07')).rejects.toMatchObject({ status: 404 });
      expect(txMock.attendance.findMany).not.toHaveBeenCalled();
    });
  });

  // ── exams ───────────────────────────────────────────────────────────────

  describe('exams', () => {
    it('returns only exams at/after now, for the student\'s own section, with subject names', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
      txMock.exam.findMany.mockResolvedValue([
        {
          id: 'e-2',
          title: 'Unit Test 2',
          subjectId: SUBJECT,
          scheduledAt: new Date('2026-07-25T04:00:00.000Z'),
          maxMarks: 50,
          syllabus: 'Ch. 4-6',
        },
      ]);

      const result = await svc.exams(USER);

      expect(result).toEqual([
        {
          id: 'e-2',
          title: 'Unit Test 2',
          subjectName: 'Mathematics',
          scheduledAt: new Date('2026-07-25T04:00:00.000Z'),
          maxMarks: 50,
          syllabus: 'Ch. 4-6',
        },
      ]);
      // Past exams are excluded by the DB filter, not in JS — assert the where.
      expect(txMock.exam.findMany).toHaveBeenCalledWith({
        where: {
          schoolId: SCHOOL,
          classSectionId: CLASS_SECTION,
          scheduledAt: { gte: new Date('2026-07-21T12:00:00.000Z') },
        },
        orderBy: [{ scheduledAt: 'asc' }],
      });
      jest.useRealTimers();
    });

    it('orders by scheduledAt ascending as returned by the DB', async () => {
      const first = new Date('2026-07-25T04:00:00.000Z');
      const second = new Date('2026-08-01T04:00:00.000Z');
      txMock.exam.findMany.mockResolvedValue([
        { id: 'e-1', title: 'A', subjectId: SUBJECT, scheduledAt: first, maxMarks: 50, syllabus: null },
        { id: 'e-2', title: 'B', subjectId: SUBJECT, scheduledAt: second, maxMarks: 50, syllabus: null },
      ]);

      const result = await svc.exams(USER);

      expect(result.map((e) => e.id)).toEqual(['e-1', 'e-2']);
      expect(txMock.exam.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ scheduledAt: 'asc' }] }),
      );
    });

    it('returns [] without querying exams when the student has no class section', async () => {
      txMock.student.findFirst.mockResolvedValue({
        id: STUDENT,
        userId: USER,
        classSectionId: null,
        classSection: null,
      });

      await expect(svc.exams(USER)).resolves.toEqual([]);
      expect(txMock.exam.findMany).not.toHaveBeenCalled();
    });

    it('returns [] for a section with no upcoming exams, without a subject lookup', async () => {
      txMock.exam.findMany.mockResolvedValue([]);

      await expect(svc.exams(USER)).resolves.toEqual([]);
      expect(txMock.subject.findMany).not.toHaveBeenCalled();
    });

    it('scopes the subject lookup to this school', async () => {
      txMock.exam.findMany.mockResolvedValue([
        {
          id: 'e-1',
          title: 'A',
          subjectId: SUBJECT,
          scheduledAt: new Date('2026-08-01T04:00:00.000Z'),
          maxMarks: 50,
          syllabus: null,
        },
      ]);

      await svc.exams(USER);

      expect(txMock.subject.findMany).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, id: { in: [SUBJECT] } },
        select: { id: true, name: true },
      });
    });

    it('404s when the login has no student record', async () => {
      txMock.student.findFirst.mockResolvedValue(null);

      await expect(svc.exams(USER)).rejects.toMatchObject({ status: 404 });
      expect(txMock.exam.findMany).not.toHaveBeenCalled();
    });
  });

  // ── results ─────────────────────────────────────────────────────────────

  describe('results', () => {
    const examA = {
      id: 'exam-a',
      title: 'Midterm',
      subjectId: SUBJECT,
      scheduledAt: new Date('2026-06-10T04:00:00.000Z'),
      maxMarks: 100,
    };
    const examB = {
      id: 'exam-b',
      title: 'Unit Test 1',
      subjectId: SUBJECT,
      scheduledAt: new Date('2026-07-05T04:00:00.000Z'),
      maxMarks: 50,
    };

    it('returns published results newest-first with the class average to 1 decimal', async () => {
      txMock.result.findMany.mockResolvedValue([
        { examId: 'exam-a', marks: 80 },
        { examId: 'exam-b', marks: 40 },
      ]);
      txMock.exam.findMany.mockResolvedValue([examA, examB]);
      txMock.result.groupBy.mockResolvedValue([
        // 71.666… → 71.7
        { examId: 'exam-a', _avg: { marks: 71.66666666 } },
        { examId: 'exam-b', _avg: { marks: 33.25 } },
      ]);

      const result = await svc.results(USER);

      expect(result).toEqual([
        {
          examId: 'exam-b',
          title: 'Unit Test 1',
          subjectName: 'Mathematics',
          scheduledAt: examB.scheduledAt,
          marks: 40,
          maxMarks: 50,
          classAverage: 33.3,
        },
        {
          examId: 'exam-a',
          title: 'Midterm',
          subjectName: 'Mathematics',
          scheduledAt: examA.scheduledAt,
          marks: 80,
          maxMarks: 100,
          classAverage: 71.7,
        },
      ]);
    });

    it('reads ONLY the caller\'s own published results — never another student\'s marks', async () => {
      txMock.result.findMany.mockResolvedValue([{ examId: 'exam-a', marks: 80 }]);
      txMock.exam.findMany.mockResolvedValue([examA]);
      txMock.result.groupBy.mockResolvedValue([{ examId: 'exam-a', _avg: { marks: 71.5 } }]);

      const result = await svc.results(USER);

      // The individual-marks read is keyed on the caller's own Student.id and
      // filtered to published rows.
      expect(txMock.result.findMany).toHaveBeenCalledWith({
        where: { studentId: STUDENT, publishedAt: { not: null } },
        select: { examId: true, marks: true },
      });
      expect(txMock.result.findMany).toHaveBeenCalledTimes(1);
      // The average is aggregated in the DB — no second row-level read that
      // could pull a classmate's mark into this process.
      expect(txMock.result.groupBy).toHaveBeenCalledWith({
        by: ['examId'],
        where: { examId: { in: ['exam-a'] }, publishedAt: { not: null } },
        _avg: { marks: true },
      });
      // …and nothing in the response is keyed to another student.
      expect(JSON.stringify(result)).not.toContain(OTHER_STUDENT);
    });

    it('excludes unpublished results from the student\'s own rows AND from the average', async () => {
      // Only the published row comes back from the (filtered) query.
      txMock.result.findMany.mockResolvedValue([{ examId: 'exam-a', marks: 80 }]);
      txMock.exam.findMany.mockResolvedValue([examA]);
      txMock.result.groupBy.mockResolvedValue([{ examId: 'exam-a', _avg: { marks: 71.5 } }]);

      const result = await svc.results(USER);

      expect(result.map((r) => r.examId)).toEqual(['exam-a']);
      // Both reads carry the publishedAt filter.
      expect(txMock.result.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ publishedAt: { not: null } }),
        }),
      );
      expect(txMock.result.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ publishedAt: { not: null } }),
        }),
      );
    });

    it('returns [] and skips the exam/average reads when nothing is published yet', async () => {
      txMock.result.findMany.mockResolvedValue([]);

      await expect(svc.results(USER)).resolves.toEqual([]);
      expect(txMock.exam.findMany).not.toHaveBeenCalled();
      expect(txMock.result.groupBy).not.toHaveBeenCalled();
    });

    it('scopes the exam lookup to this school and drops a result whose exam is foreign', async () => {
      txMock.result.findMany.mockResolvedValue([
        { examId: 'exam-a', marks: 80 },
        { examId: 'exam-foreign', marks: 99 },
      ]);
      // The schoolId-scoped lookup simply does not return the foreign exam.
      txMock.exam.findMany.mockResolvedValue([examA]);
      txMock.result.groupBy.mockResolvedValue([{ examId: 'exam-a', _avg: { marks: 71.5 } }]);

      const result = await svc.results(USER);

      expect(txMock.exam.findMany).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, id: { in: ['exam-a', 'exam-foreign'] } },
      });
      expect(result.map((r) => r.examId)).toEqual(['exam-a']);
    });

    it('treats a null aggregate average as 0 rather than NaN', async () => {
      txMock.result.findMany.mockResolvedValue([{ examId: 'exam-a', marks: 80 }]);
      txMock.exam.findMany.mockResolvedValue([examA]);
      txMock.result.groupBy.mockResolvedValue([{ examId: 'exam-a', _avg: { marks: null } }]);

      const result = await svc.results(USER);

      expect(result[0].classAverage).toBe(0);
    });

    it('404s when the login has no student record', async () => {
      txMock.student.findFirst.mockResolvedValue(null);

      await expect(svc.results(USER)).rejects.toMatchObject({ status: 404 });
      expect(txMock.result.findMany).not.toHaveBeenCalled();
    });
  });

  // ── registerPushToken ──────────────────────────────────────────────────
  // Deliberately does NOT go through `myStudent` — a TEACHER/STAFF/
  // SCHOOL_ADMIN login must be able to register a device too, and has no
  // `Student` row at all. None of these tests touch `txMock.student`.

  describe('registerPushToken', () => {
    beforeEach(() => {
      txMock.user.findUnique.mockResolvedValue({ email: 'teacher@green.test' });
      txMock.pushToken.upsert.mockResolvedValue({ id: 'pt-1' });
    });

    it('resolves the email from the JWT sub via User, not via myStudent', async () => {
      await svc.registerPushToken(USER, 'ExponentPushToken[a]', 'android');

      expect(txMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER },
        select: { email: true },
      });
      expect(txMock.student.findFirst).not.toHaveBeenCalled();
    });

    it('upserts by token, scoped to the tenant schoolId', async () => {
      await svc.registerPushToken(USER, 'ExponentPushToken[a]', 'android');

      expect(txMock.pushToken.upsert).toHaveBeenCalledWith({
        where: { token: 'ExponentPushToken[a]' },
        update: {
          schoolId: SCHOOL,
          userId: USER,
          email: 'teacher@green.test',
          lastSeenAt: expect.any(Date),
        },
        create: {
          schoolId: SCHOOL,
          userId: USER,
          email: 'teacher@green.test',
          token: 'ExponentPushToken[a]',
          platform: 'android',
        },
      });
    });

    it('404s when the JWT sub has no User row', async () => {
      txMock.user.findUnique.mockResolvedValue(null);

      await expect(
        svc.registerPushToken(USER, 'ExponentPushToken[a]', 'android'),
      ).rejects.toMatchObject({ status: 404 });
      expect(txMock.pushToken.upsert).not.toHaveBeenCalled();
    });

    /**
     * `PushToken.token` is globally unique, but the upsert above runs inside
     * `withTenant()` (RLS-bound to THIS school). If the same physical device
     * previously registered under a DIFFERENT school's tenant, that row is
     * invisible to this transaction's RLS scope, so Postgres's (unfiltered)
     * unique index still reports a conflict that `ON CONFLICT DO UPDATE`
     * cannot resolve — Prisma surfaces this as P2002. A device token is a
     * per-DEVICE identity, not a per-tenant one (see push.channel.ts's
     * docstring), so the correct behavior on that conflict is to REASSIGN the
     * row to the new registrant (last-writer-wins) via the platform
     * (BYPASSRLS) client, not to error and leave the device receiving the
     * old tenant's notifications.
     */
    it('reassigns a token that already exists under a DIFFERENT tenant instead of throwing', async () => {
      const { Prisma } = jest.requireActual('@skoolos/db');
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`token`)',
        { code: 'P2002', clientVersion: 'test', meta: { target: ['token'] } },
      );
      txMock.pushToken.upsert.mockRejectedValue(p2002);
      platformMock.pushToken.update.mockResolvedValue({
        id: 'pt-shared',
        schoolId: SCHOOL,
        userId: USER,
      });

      const result = await svc.registerPushToken(USER, 'ExponentPushToken[shared]', 'ios');

      expect(platformMock.pushToken.update).toHaveBeenCalledWith({
        where: { token: 'ExponentPushToken[shared]' },
        data: {
          schoolId: SCHOOL,
          userId: USER,
          email: 'teacher@green.test',
          platform: 'ios',
          lastSeenAt: expect.any(Date),
        },
      });
      expect(result).toEqual({ id: 'pt-shared', schoolId: SCHOOL, userId: USER });
    });

    it('does not attempt reassignment for a non-P2002 error — rethrows as-is', async () => {
      txMock.pushToken.upsert.mockRejectedValue(new Error('connection reset'));

      await expect(
        svc.registerPushToken(USER, 'ExponentPushToken[a]', 'android'),
      ).rejects.toThrow('connection reset');
      expect(platformMock.pushToken.update).not.toHaveBeenCalled();
    });
  });

  // ── tenancy ─────────────────────────────────────────────────────────────

  it('opens every tenant transaction with the schoolId from the request context', async () => {
    txMock.attendance.findMany.mockResolvedValue([]);

    await svc.attendance(USER, '2026-07');

    expect(tenant.requireTenant).toHaveBeenCalled();
    for (const call of withTenantMock.mock.calls) {
      expect(call[0]).toBe(SCHOOL);
    }
  });
});
