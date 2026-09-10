import 'reflect-metadata';

const txMock = {
  academicYear: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  classSection: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  student: { groupBy: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  sessionPlan: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
  sessionDecision: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
  $executeRaw: jest.fn(),
  grade: { findMany: jest.fn() },
  exam: { findMany: jest.fn() },
  attendance: { groupBy: jest.fn() },
  result: { findMany: jest.fn() },
  timetableSlot: { findMany: jest.fn(), createMany: jest.fn() },
  registerChangeRequest: { updateMany: jest.fn() },
  school: { findUnique: jest.fn() },
  user: { findMany: jest.fn(), updateMany: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  notification: { createMany: jest.fn() },
  notificationOutbox: { createMany: jest.fn() },
  alumni: { findMany: jest.fn() },
  libraryIssue: { count: jest.fn() },
};
const platformMock: { sessionPlan: { findMany: jest.Mock } } = { sessionPlan: { findMany: jest.fn() } };
const background: Promise<unknown>[] = [];

// Spread the real Prisma enums/namespace first: the alumni barrel this service
// imports reaches controllers that read `UserRole.SCHOOL_ADMIN` at import time.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
  getPlatformPrisma: () => platformMock,
}));
jest.mock('@skoolos/config', () => ({ loadEnv: () => ({ PLATFORM_HOST: 'sckools.com' }) }));
jest.mock('../../common/notifications/run-in-background', () => ({
  runInBackground: (work: () => Promise<unknown>, onError: (e: unknown) => void) => {
    background.push(Promise.resolve(work()).catch(onError));
  },
}));

import { Prisma } from '@skoolos/db';
import { SessionsService } from './sessions.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const leavePolicy = { closeYear: jest.fn().mockResolvedValue({ carried: 1 }) };
const alumni = { graduateBatchIn: jest.fn().mockResolvedValue({ created: 1 }) };
const alumniAuth = { mintClaimToken: jest.fn().mockResolvedValue({ token: 'tok123', expiresAt: new Date() }) };
const features = { getFeatures: jest.fn().mockResolvedValue(new Set(['MANAGEMENT', 'ALUMNI'])) };
const mail = { sendAlumniWelcome: jest.fn().mockResolvedValue(true), sendSessionStarted: jest.fn().mockResolvedValue(true), sendPassedOut: jest.fn().mockResolvedValue(true), sendLeft: jest.fn().mockResolvedValue(true) };

function service() {
  return new SessionsService(audit as never, leavePolicy as never, alumni as never, alumniAuth as never, features as never, mail as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  background.length = 0;
  features.getFeatures.mockResolvedValue(new Set(['MANAGEMENT', 'ALUMNI']));
  txMock.sessionPlan.update.mockResolvedValue({ version: 2 });
  txMock.school.findUnique.mockResolvedValue({ name: 'Raffles', slug: 'raffles', timezone: 'Asia/Kolkata' });
});

describe('overview', () => {
  it('degrades to plan: null until the session_plans migration lands', async () => {
    txMock.academicYear.findMany.mockResolvedValue([{ id: 'y1', name: '2025-26', startDate: new Date(), endDate: new Date(), isCurrent: true }]);
    txMock.classSection.findMany.mockResolvedValue([{ id: 'f5a', academicYearId: 'y1' }, { id: 'f5b', academicYearId: 'y1' }]);
    txMock.student.groupBy.mockResolvedValue([{ classSectionId: 'f5a', _count: { _all: 30 } }]);
    txMock.sessionPlan.findFirst.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2021', clientVersion: '5' }));
    const o = await service().overview(SCHOOL);
    expect(o.plan).toBeNull();
    expect(o.years[0]).toMatchObject({ name: '2025-26', sections: 2, students: 30 });
  });
});

describe('createPlan', () => {
  it('refuses when a plan is open', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT' });
    await expect(service().createPlan(SCHOOL, ACTOR, { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' })).rejects.toMatchObject({ response: { code: 'PLAN_OPEN' } });
  });

  it('creates the next year (not current) and a DRAFT plan', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue(null);
    txMock.academicYear.findFirst.mockResolvedValue({ id: 'y1', name: '2025-26', isCurrent: true });
    txMock.academicYear.findUnique.mockResolvedValue(null);
    txMock.academicYear.create.mockResolvedValue({ id: 'y2', name: '2026-27', isCurrent: false });
    txMock.sessionPlan.create.mockResolvedValue({ id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2', version: 1, fromYear: { name: '2025-26' }, toYear: { name: '2026-27' } });
    const p = await service().createPlan(SCHOOL, ACTOR, { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
    expect(txMock.academicYear.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isCurrent: false, name: '2026-27' }) }));
    expect(p.status).toBe('DRAFT');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'session.plan.create' }));
  });

  it('refuses a session that ends before it starts', async () => {
    await expect(service().createPlan(SCHOOL, ACTOR, { name: '2026-27', startDate: '2027-04-01', endDate: '2026-03-31' })).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
  });
});

describe('updatePlan', () => {
  it('bumps version and stores the section map, after checking every key and value against the two years', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', version: 3, fromYearId: 'y1', toYearId: 'y2' });
    txMock.classSection.findMany.mockResolvedValue([{ id: 'f5a', academicYearId: 'y1' }, { id: 't6a', academicYearId: 'y2' }]);
    txMock.sessionPlan.update.mockResolvedValue({ id: 'p1', version: 4 });
    await expect(service().updatePlan(SCHOOL, { sectionMap: { f5a: 'elsewhere' } })).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    await expect(service().updatePlan(SCHOOL, { sectionMap: { t6a: 'PASS_OUT' } })).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    await service().updatePlan(SCHOOL, { sectionMap: { f5a: 't6a' }, passMarkPct: 40 });
    expect(txMock.sessionPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sectionMap: { f5a: 't6a' }, passMarkPct: 40, version: { increment: 1 } }) }));
  });

  it('a scheduled plan is locked', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'SCHEDULED', version: 3 });
    await expect(service().updatePlan(SCHOOL, { passMarkPct: 40 })).rejects.toMatchObject({ response: { code: 'PLAN_LOCKED' } });
  });
});

describe('copyStructure', () => {
  it('creates next-year sections, drops LEFT class teachers, builds the default map', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2', sectionMap: {} });
    txMock.grade.findMany.mockResolvedValue([{ id: 'g5', order: 5 }, { id: 'g6', order: 6 }]);
    txMock.classSection.findMany
      .mockResolvedValueOnce([
        { id: 'f5a', gradeId: 'g5', name: 'A', classTeacherId: 'T1', classTeacher: { status: 'LEFT' } },
        { id: 'f6a', gradeId: 'g6', name: 'A', classTeacherId: 'T2', classTeacher: { status: 'ACTIVE' } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 't5a', gradeId: 'g5', name: 'A', classTeacherId: null }, { id: 't6a', gradeId: 'g6', name: 'A', classTeacherId: 'T2' }]);
    txMock.classSection.create.mockResolvedValue({});
    const r = await service().copyStructure(SCHOOL);
    expect(txMock.classSection.create).toHaveBeenCalledWith({ data: { schoolId: SCHOOL, gradeId: 'g5', name: 'A', academicYearId: 'y2', classTeacherId: null } });
    expect(txMock.classSection.create).toHaveBeenCalledWith({ data: { schoolId: SCHOOL, gradeId: 'g6', name: 'A', academicYearId: 'y2', classTeacherId: 'T2' } });
    expect(r.sectionMap).toEqual({ f5a: 't6a', f6a: 'PASS_OUT' });
    expect(r.sectionsWithoutClassTeacher).toEqual(['t5a']);
    expect(r.created).toBe(2);
  });

  it('refuses when grade order is ambiguous', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2' });
    txMock.grade.findMany.mockResolvedValue([{ id: 'g5', order: 0 }, { id: 'g6', order: 0 }]);
    await expect(service().copyStructure(SCHOOL)).rejects.toMatchObject({ response: { code: 'GRADE_ORDER' } });
  });
});

describe('sectionRows', () => {
  it('computes attendance and results %, flags review, marks late joiners, defaults decisions', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({
      id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2', passMarkPct: 33, countExamIds: [], sectionMap: { f5b: 't6b' },
      createdAt: new Date('2026-03-01'), fromYear: { startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') },
    });
    txMock.classSection.findFirst.mockResolvedValue({ id: 'f5b', gradeId: 'g5', name: 'B', grade: { name: '5' } });
    txMock.classSection.findMany.mockResolvedValue([{ id: 't6b', gradeId: 'g6', name: 'B', grade: { name: '6' } }, { id: 't5b', gradeId: 'g5', name: 'B', grade: { name: '5' } }]);
    txMock.exam.findMany.mockResolvedValue([{ id: 'e1', title: 'Annual', maxMarks: 100, scheduledAt: new Date('2026-03-01') }]);
    txMock.student.findMany.mockResolvedValue([
      { id: 's1', firstName: 'Aarav', lastName: 'Mehta', admissionNo: '1', rollNo: '1', createdAt: new Date('2025-04-02') },
      { id: 's2', firstName: 'Dev', lastName: 'Sharma', admissionNo: '2', rollNo: '3', createdAt: new Date('2026-03-15') },
    ]);
    txMock.attendance.groupBy.mockResolvedValue([{ studentId: 's1', status: 'PRESENT', _count: { _all: 1 } }, { studentId: 's1', status: 'ABSENT', _count: { _all: 1 } }, { studentId: 's2', status: 'PRESENT', _count: { _all: 1 } }]);
    txMock.result.findMany.mockResolvedValue([{ studentId: 's1', marks: 81, examId: 'e1', exam: { maxMarks: 100 } }, { studentId: 's2', marks: 29, examId: 'e1', exam: { maxMarks: 100 } }]);
    txMock.sessionDecision.findMany.mockResolvedValue([]);
    const r = await service().sectionRows(SCHOOL, 'f5b');
    expect(r.rows[0]).toMatchObject({ studentId: 's1', attendancePct: 50, resultsPct: 81, review: false, joinedSincePlan: false, decision: null, toSectionId: 't6b', defaultDecision: 'PROMOTE', stayToSectionId: 't5b' });
    expect(r.rows[1]).toMatchObject({ studentId: 's2', resultsPct: 29, review: true, joinedSincePlan: true });
    expect(txMock.student.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE', classSectionId: 'f5b' });
    expect(r.targets.map((t) => t.label)).toEqual(['6 B', '5 B']);
    expect(r.exams[0].counted).toBe(true);
  });

  it('counts only this class\'s chosen exams; ids from other classes are ignored, and none chosen means all', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({
      id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2', passMarkPct: 33, countExamIds: ['other-class-exam'], sectionMap: {},
      createdAt: new Date('2026-03-01'), fromYear: { startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') },
    });
    txMock.classSection.findFirst.mockResolvedValue({ id: 'f5b', gradeId: 'g5', name: 'B', grade: { name: '5' } });
    txMock.classSection.findMany.mockResolvedValue([]);
    txMock.exam.findMany.mockResolvedValue([{ id: 'e1', title: 'Annual', maxMarks: 100, scheduledAt: new Date() }]);
    txMock.student.findMany.mockResolvedValue([{ id: 's1', firstName: 'A', lastName: 'B', admissionNo: '1', rollNo: '1', createdAt: new Date('2025-05-01') }]);
    txMock.attendance.groupBy.mockResolvedValue([]);
    txMock.result.findMany.mockResolvedValue([{ studentId: 's1', marks: 50, examId: 'e1', exam: { maxMarks: 100 } }]);
    txMock.sessionDecision.findMany.mockResolvedValue([]);
    const r = await service().sectionRows(SCHOOL, 'f5b');
    expect(txMock.result.findMany.mock.calls[0][0].where.examId).toEqual({ in: ['e1'] });
    expect(r.rows[0].resultsPct).toBe(50);
  });
});

describe('upsertDecisions', () => {
  beforeEach(() => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', toYearId: 'y2', version: 1 });
    txMock.classSection.findMany.mockResolvedValue([{ id: 't6b' }]);
    txMock.student.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
  });

  it('rejects a PROMOTE into a section outside the next year', async () => {
    await expect(service().upsertDecisions(SCHOOL, ACTOR, { rows: [{ studentId: 's1', decision: 'PROMOTE', toSectionId: 'f5b' }] })).rejects.toMatchObject({ response: { code: 'BAD_TARGET' } });
  });

  it('rejects a student who is not on the active roll', async () => {
    await expect(service().upsertDecisions(SCHOOL, ACTOR, { rows: [{ studentId: 's9', decision: 'PASS_OUT' }] })).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });

  it('upserts rows and bumps the plan version', async () => {
    txMock.sessionDecision.upsert.mockResolvedValue({});
    txMock.sessionPlan.update.mockResolvedValue({ version: 2 });
    const r = await service().upsertDecisions(SCHOOL, ACTOR, {
      rows: [{ studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' }, { studentId: 's2', decision: 'LEAVE', leaveStatus: 'TRANSFERRED', leaveReason: 'Moved' }],
    });
    expect(txMock.sessionDecision.upsert).toHaveBeenCalledTimes(2);
    expect(txMock.sessionDecision.upsert.mock.calls[1][0].create).toMatchObject({ decision: 'LEAVE', leaveStatus: 'TRANSFERRED', toSectionId: null, decidedById: ACTOR });
    expect(r).toEqual({ saved: 2, version: 2 });
  });
});

describe('start', () => {
  const plan = {
    id: 'p1', status: 'DRAFT', version: 4, fromYearId: 'y1', toYearId: 'y2', rollPolicy: 'KEEP', copyTimetable: true, carryLeave: true,
    fromYear: { name: '2025-26', endDate: new Date('2026-03-31'), startDate: new Date('2025-04-01') },
    toYear: { name: '2026-27', startDate: new Date('2026-04-01') },
  };
  const S1 = { id: 's1', userId: 'u1', email: null, firstName: 'Aarav', lastName: 'M', admissionNo: '1', rollNo: '1', classSectionId: 'f5b' };
  const S2 = { id: 's2', userId: 'u2', email: 'dev@x.in', firstName: 'Dev', lastName: 'S', admissionNo: '2', rollNo: '2', classSectionId: 'f5b' };
  const S3 = { id: 's3', userId: null, email: 'zoya@x.in', firstName: 'Zoya', lastName: 'K', admissionNo: '3', rollNo: '3', classSectionId: 'f5b' };
  beforeEach(() => {
    txMock.sessionPlan.findFirst.mockResolvedValue(plan);
    txMock.sessionPlan.updateMany.mockResolvedValue({ count: 1 });
    txMock.school.findUnique.mockResolvedValue({ name: 'Raffles', slug: 'raffles', timezone: 'Asia/Kolkata', domains: [] });
    txMock.classSection.findMany.mockResolvedValue([
      { id: 'f5b', gradeId: 'g5', name: 'B', academicYearId: 'y1', classTeacherId: 'T1', grade: { name: '5' } },
      { id: 't6b', gradeId: 'g6', name: 'B', academicYearId: 'y2', classTeacherId: 'T1', grade: { name: '6' } },
      { id: 't5b', gradeId: 'g5', name: 'B', academicYearId: 'y2', classTeacherId: null, grade: { name: '5' } },
    ]);
    txMock.student.findMany.mockResolvedValue([S1, S2]);
    txMock.sessionDecision.findMany.mockResolvedValue([
      { studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' },
      { studentId: 's2', decision: 'PASS_OUT', toSectionId: null },
    ]);
    txMock.student.updateMany.mockResolvedValue({ count: 1 });
    txMock.sessionDecision.updateMany.mockResolvedValue({ count: 1 });
    txMock.timetableSlot.findMany.mockImplementation(({ where }: { where: { academicYearId: string } }) =>
      Promise.resolve(
        where.academicYearId === 'y1'
          ? [
              { classSectionId: 'f5b', dayOfWeek: 1, periodId: 'pd', subjectId: 'sb', teacherId: 'T1', teacher: { status: 'ACTIVE', userId: 'tu1' } },
              { classSectionId: 'f5b', dayOfWeek: 2, periodId: 'pd', subjectId: 'sb', teacherId: 'T9', teacher: { status: 'LEFT', userId: 'tu9' } },
            ]
          : [],
      ),
    );
    txMock.timetableSlot.createMany.mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
    txMock.registerChangeRequest.updateMany.mockResolvedValue({ count: 0 });
    txMock.user.findMany.mockResolvedValue([{ id: 'u1', email: 'family@x.in' }]);
    txMock.alumni.findMany.mockResolvedValue([{ id: 'al2', email: 'dev@x.in' }]);
  });

  it('refuses on version mismatch and on undecided students, and nothing is written', async () => {
    await expect(service().start(SCHOOL, ACTOR, { when: 'NOW', version: 3 })).rejects.toMatchObject({ response: { code: 'PLAN_CHANGED' } });
    txMock.sessionDecision.findMany.mockResolvedValue([{ studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' }]);
    await expect(service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 })).rejects.toMatchObject({ response: { code: 'UNDECIDED_STUDENTS' } });
    expect(txMock.student.updateMany).not.toHaveBeenCalled();
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('claims the plan first: a second Start (or the cron after a click) finds nothing open', async () => {
    txMock.sessionPlan.updateMany.mockResolvedValue({ count: 0 });
    await expect(service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 })).rejects.toMatchObject({ response: { code: 'NO_PLAN' } });
    expect(txMock.student.updateMany).not.toHaveBeenCalled();
  });

  it('moves seats in one statement per class, graduates ONLY the passing-out children, closes their logins, flips the year, copies the timetable for active teachers, carries leave, tells families', async () => {
    const r = await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    await Promise.all(background);
    expect(r).toMatchObject({ started: true, moved: 1, alumni: 1, left: 0, slotsCopied: 1, slotsSkipped: 1 });
    expect(txMock.sessionPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'p1', status: { in: ['DRAFT', 'SCHEDULED'] } }), data: expect.objectContaining({ status: 'STARTED', startedById: ACTOR }) }));
    expect(alumni.graduateBatchIn).toHaveBeenCalledWith(txMock, SCHOOL, { classSectionIds: ['f5b'], batchYear: 2026 }, ['s2']);
    // Seats: KEEP → one updateMany per destination class, no per-child statements.
    expect(txMock.student.updateMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, id: { in: ['s1'] } }, data: { classSectionId: 't6b' } });
    // Alumni: the same fields applyStudentLeave writes, in one statement.
    expect(txMock.student.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: SCHOOL, id: { in: ['s2'] }, status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'ALUMNI', alumniBatch: '2025-26', isActive: false, leftOn: new Date('2026-03-31'), statusChangedById: ACTOR }),
    }));
    expect(txMock.user.updateMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, id: { in: ['u2'] } }, data: { isActive: false } });
    expect(txMock.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { schoolId: SCHOOL, userId: { in: ['u2'] }, revokedAt: null } }));
    expect(txMock.academicYear.update).toHaveBeenCalledWith({ where: { id: 'y1' }, data: { isCurrent: false } });
    expect(txMock.academicYear.update).toHaveBeenCalledWith({ where: { id: 'y2' }, data: { isCurrent: true } });
    // The timetable follows the CLASSROOM (5 B → next year's 5 B) and is visible from today when the session starts early.
    const slots = txMock.timetableSlot.createMany.mock.calls[0][0].data;
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ classSectionId: 't5b', academicYearId: 'y2', teacherId: 'T1' });
    expect(slots[0].effectiveFrom.getTime()).toBeLessThanOrEqual(Date.now());
    expect(txMock.sessionDecision.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ planId: 'p1', studentId: { in: ['s1', 's2'] } }), data: expect.objectContaining({ fromSectionId: 'f5b' }) }));
    expect(txMock.registerChangeRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
    expect(leavePolicy.closeYear).toHaveBeenCalledWith(SCHOOL, 'y1', 'y2');
    // The bell: one statement for the family and the teacher whose class was copied.
    expect(txMock.notification.createMany).toHaveBeenCalledTimes(1);
    expect(txMock.notification.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: 'u1', kind: 'SESSION', title: 'Aarav is in 6 B for 2026-27' }),
      expect.objectContaining({ userId: 'tu1', kind: 'SESSION' }),
    ]);
    // Push: one outbox row per family, rendered through the announcement template by the drain.
    expect(txMock.notificationOutbox.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ kind: 'SESSION_STARTED', targetUserId: 'u1', payload: expect.objectContaining({ title: 'Aarav is in 6 B for 2026-27' }) }),
    ]);
    // The alumnus got the door, so no plain passed-out letter on top.
    expect(mail.sendPassedOut).not.toHaveBeenCalled();
    // The mails, after commit: the family's new class and the alumnus's door on the school's own host.
    expect(mail.sendSessionStarted).toHaveBeenCalledWith('family@x.in', 'Raffles', 'Aarav', '6 B', '2026-27', SCHOOL);
    expect(alumniAuth.mintClaimToken).toHaveBeenCalledWith(SCHOOL, 'al2');
    expect(mail.sendAlumniWelcome).toHaveBeenCalledWith('dev@x.in', 'Raffles', 'https://raffles.sckools.com/alumni#claim=tok123', SCHOOL);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'session.start' }));
  });

  it('a custom domain carries the alumni door', async () => {
    txMock.school.findUnique.mockResolvedValue({ name: 'Raffles', slug: 'raffles', timezone: 'Asia/Kolkata', domains: [{ hostname: 'www.raffles.edu.in' }] });
    await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    await Promise.all(background);
    expect(mail.sendAlumniWelcome).toHaveBeenCalledWith('dev@x.in', 'Raffles', 'https://www.raffles.edu.in/alumni#claim=tok123', SCHOOL);
  });

  it('LEAVE writes the chosen status with its reason and closes the login; renumbering seats goes through one VALUES update per class', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ ...plan, rollPolicy: 'ALPHABETICAL' });
    txMock.student.findMany.mockResolvedValue([S1, S2, S3]);
    txMock.sessionDecision.findMany.mockResolvedValue([
      { studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' },
      { studentId: 's3', decision: 'PROMOTE', toSectionId: 't6b' },
      { studentId: 's2', decision: 'LEAVE', toSectionId: null, leaveStatus: 'TRANSFERRED', leaveReason: 'Moved to Pune', note: null },
    ]);
    const r = await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    expect(r).toMatchObject({ moved: 2, alumni: 0, left: 1 });
    expect(alumni.graduateBatchIn).not.toHaveBeenCalled();
    expect(txMock.student.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: SCHOOL, id: { in: ['s2'] }, status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'TRANSFERRED', alumniBatch: null }),
    }));
    // Two raw statements: the renumbered seats for 6 B, and the leave reason.
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(txMock.user.updateMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, id: { in: ['u2'] } }, data: { isActive: false } });
  });

  it('a final-grade child who stays in grade is not graduated', async () => {
    txMock.student.findMany.mockResolvedValue([S1, S2, S3]);
    txMock.sessionDecision.findMany.mockResolvedValue([
      { studentId: 's1', decision: 'PASS_OUT', toSectionId: null },
      { studentId: 's2', decision: 'PASS_OUT', toSectionId: null },
      { studentId: 's3', decision: 'STAY', toSectionId: 't5b' },
    ]);
    await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    expect(alumni.graduateBatchIn).toHaveBeenCalledWith(txMock, SCHOOL, { classSectionIds: ['f5b'], batchYear: 2026 }, ['s1', 's2']);
    expect(txMock.student.updateMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, id: { in: ['s3'] } }, data: { classSectionId: 't5b' } });
  });

  it('never doubles a period the office already placed in the new year, for the class or for the teacher', async () => {
    txMock.timetableSlot.findMany.mockImplementation(({ where }: { where: { academicYearId: string } }) =>
      Promise.resolve(
        where.academicYearId === 'y1'
          ? [
              { classSectionId: 'f5b', dayOfWeek: 1, periodId: 'pd', subjectId: 'sb', teacherId: 'T1', teacher: { status: 'ACTIVE', userId: 'tu1' } },
              { classSectionId: 'f5b', dayOfWeek: 3, periodId: 'pd', subjectId: 'sb', teacherId: 'T2', teacher: { status: 'ACTIVE', userId: 'tu2' } },
            ]
          : [{ classSectionId: 't6b', dayOfWeek: 1, periodId: 'pd', teacherId: 'T1' }],
      ),
    );
    const r = await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    // Monday's period: T1 already teaches then in the new year → skipped. Wednesday copies.
    expect(r).toMatchObject({ slotsCopied: 1, slotsSkipped: 1 });
    expect(txMock.timetableSlot.createMany.mock.calls[0][0].data[0]).toMatchObject({ dayOfWeek: 3, teacherId: 'T2' });
  });

  it('skips graduation and the alumni mail when the school has no Alumni wing', async () => {
    features.getFeatures.mockResolvedValue(new Set(['MANAGEMENT']));
    await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    await Promise.all(background);
    expect(alumni.graduateBatchIn).not.toHaveBeenCalled();
    expect(mail.sendAlumniWelcome).not.toHaveBeenCalled();
    expect(txMock.student.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ALUMNI' }) }));
    // Without the wing, the passed-out letter is the only word the child gets.
    expect(mail.sendPassedOut).toHaveBeenCalledWith('dev@x.in', 'Raffles', 'Dev', '2026-27', SCHOOL);
  });

  it('a child who stays in grade is told "continues in", and a leaver with an address gets the left letter', async () => {
    txMock.student.findMany.mockResolvedValue([S1, S2, S3]);
    txMock.sessionDecision.findMany.mockResolvedValue([
      { studentId: 's1', decision: 'STAY', toSectionId: 't5b' },
      { studentId: 's2', decision: 'LEAVE', toSectionId: null, leaveStatus: 'TRANSFERRED', leaveReason: null, note: null },
      { studentId: 's3', decision: 'LEAVE', toSectionId: null, leaveStatus: 'LEFT', leaveReason: null, note: null },
    ]);
    await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    await Promise.all(background);
    expect(txMock.notification.createMany.mock.calls[0][0].data[0]).toMatchObject({ userId: 'u1', title: 'Aarav continues in 5 B for 2026-27' });
    expect(mail.sendLeft).toHaveBeenCalledWith('dev@x.in', 'Raffles', 'Dev', 'TRANSFERRED', '2026-27', SCHOOL);
    expect(mail.sendLeft).toHaveBeenCalledWith('zoya@x.in', 'Raffles', 'Zoya', 'LEFT', '2026-27', SCHOOL);
  });

  it('refuses when a promoted child points at a class that no longer exists', async () => {
    txMock.sessionDecision.findMany.mockResolvedValue([{ studentId: 's1', decision: 'PROMOTE', toSectionId: 'gone' }, { studentId: 's2', decision: 'PASS_OUT', toSectionId: null }]);
    await expect(service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 })).rejects.toMatchObject({ response: { code: 'BAD_TARGET' } });
  });

  it('failures after commit (leave carry-forward, notifications) are logged, never thrown', async () => {
    leavePolicy.closeYear.mockRejectedValueOnce(new Error('boom'));
    txMock.notification.createMany.mockRejectedValueOnce(new Error('inbox down'));
    const r = await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    expect(r).toMatchObject({ started: true });
  });

  it('ON_START_DATE schedules at the school midnight instead of applying', async () => {
    const r = await service().start(SCHOOL, ACTOR, { when: 'ON_START_DATE', version: 4 });
    expect(r).toEqual({ scheduled: true, scheduledFor: '2026-03-31T18:30:00.000Z' });
    expect(txMock.sessionPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) }));
    expect(txMock.sessionPlan.updateMany).not.toHaveBeenCalled();
    expect(txMock.student.updateMany).not.toHaveBeenCalled();
  });
});

describe('register and the cron', () => {
  it('register joins decisions with names and section labels', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'STARTED', fromYearId: 'y1', toYearId: 'y2' });
    txMock.sessionDecision.findMany.mockResolvedValue([
      { studentId: 's1', decision: 'PROMOTE', fromSectionId: 'f5b', toSectionId: 't6b', leaveStatus: null, decidedById: 'u9', appliedAt: new Date('2026-04-01'), student: { firstName: 'Aarav', lastName: 'Mehta', admissionNo: '1', email: null } },
    ]);
    txMock.classSection.findMany.mockResolvedValue([{ id: 'f5b', name: 'B', grade: { name: '5' } }, { id: 't6b', name: 'B', grade: { name: '6' } }]);
    txMock.user.findMany.mockResolvedValue([{ id: 'u9', email: 'office@x.in' }]);
    const r = await service().register(SCHOOL, 'y1');
    expect(r[0]).toMatchObject({ name: 'Aarav Mehta', email: null, fromSection: '5 B', toSection: '6 B', decision: 'PROMOTE', decidedBy: 'office@x.in' });
  });

  it('register is empty for a year that was never closed through a plan', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue(null);
    expect(await service().register(SCHOOL, 'y0')).toEqual([]);
  });

  it('startDue starts every scheduled plan whose time has come, as the person who scheduled it', async () => {
    platformMock.sessionPlan.findMany.mockResolvedValue([{ id: 'p1', schoolId: SCHOOL, createdById: 'u1' }]);
    const svc = service();
    const outcome = { moved: 0, alumni: 0, left: 0, slotsCopied: 0, slotsSkipped: 0, alumniDoor: false, alumniStudentIds: [], teacherUserIds: [], familyUserIds: [], sessionName: '2026-27', schoolName: 'R', schoolHost: 'r.sckools.com', carryLeave: false, fromYearId: 'y1', toYearId: 'y2' };
    const apply = jest.spyOn(svc as never, 'applyPlan' as never).mockResolvedValue(outcome as never);
    const after = jest.spyOn(svc as never, 'afterStart' as never).mockResolvedValue(undefined as never);
    const r = await svc.startDue(new Date('2026-03-31T18:31:00Z'));
    expect(platformMock.sessionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'SCHEDULED', scheduledFor: { lte: new Date('2026-03-31T18:31:00Z') } } }));
    expect(apply).toHaveBeenCalledWith(SCHOOL, 'u1', 'p1');
    expect(apply.mock.calls[0]).toHaveLength(3); // no version gate for the cron
    expect(after).toHaveBeenCalledWith(SCHOOL, outcome);
    expect(r).toEqual({ started: ['p1'] });
  });

  it('startDue keeps going when one school fails', async () => {
    platformMock.sessionPlan.findMany.mockResolvedValue([{ id: 'p1', schoolId: SCHOOL, createdById: 'u1' }, { id: 'p2', schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', createdById: 'u2' }]);
    const svc = service();
    jest.spyOn(svc as never, 'applyPlan' as never).mockRejectedValueOnce(new Error('boom') as never).mockResolvedValueOnce({} as never);
    jest.spyOn(svc as never, 'afterStart' as never).mockResolvedValue(undefined as never);
    expect(await svc.startDue()).toEqual({ started: ['p2'] });
  });
});

describe('applyDefaults — the master Promote button', () => {
  beforeEach(() => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', version: 2, fromYearId: 'y1', toYearId: 'y2', sectionMap: { f5b: 't6b', f10a: 'PASS_OUT' } });
    txMock.classSection.findMany.mockResolvedValue([
      { id: 'f5b', name: 'B', academicYearId: 'y1', grade: { name: '5' } },
      { id: 'f10a', name: 'A', academicYearId: 'y1', grade: { name: '10' } },
      { id: 'f7c', name: 'C', academicYearId: 'y1', grade: { name: '7' } },
      { id: 't6b', name: 'B', academicYearId: 'y2', grade: { name: '6' } },
    ]);
    txMock.student.findMany.mockResolvedValue([
      { id: 's1', classSectionId: 'f5b' }, { id: 's2', classSectionId: 'f5b' }, { id: 's3', classSectionId: 'f10a' }, { id: 's4', classSectionId: 'f7c' },
    ]);
    txMock.sessionDecision.findMany.mockResolvedValue([{ studentId: 's2' }]);
    txMock.sessionDecision.createMany.mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
    txMock.sessionPlan.update.mockResolvedValue({ version: 3 });
  });

  it('promotes every undecided child by the class map, passes out the top grade, never touches a decided child, and names the unmapped classes', async () => {
    const r = await service().applyDefaults(SCHOOL, ACTOR);
    expect(r).toEqual({ decided: 2, alreadyDecided: 1, unmapped: ['7 C'], version: 3 });
    const calls = txMock.sessionDecision.createMany.mock.calls.map((c) => c[0]);
    expect(calls[0].data).toEqual([expect.objectContaining({ studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b', decidedById: ACTOR })]);
    expect(calls[0].skipDuplicates).toBe(true);
    expect(calls[1].data).toEqual([expect.objectContaining({ studentId: 's3', decision: 'PASS_OUT', toSectionId: null })]);
  });
});

describe('copyTimetableNow — adjust before Start', () => {
  it('copies into the next year effective from its first day, skipping what the office already placed, and Start later copies nothing twice', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2', toYear: { startDate: new Date('2026-04-01') } });
    txMock.classSection.findMany.mockResolvedValue([
      { id: 'f5b', gradeId: 'g5', name: 'B', academicYearId: 'y1' },
      { id: 't5b', gradeId: 'g5', name: 'B', academicYearId: 'y2' },
    ]);
    txMock.timetableSlot.findMany.mockImplementation(({ where }: { where: { academicYearId: string } }) =>
      Promise.resolve(
        where.academicYearId === 'y1'
          ? [
              { classSectionId: 'f5b', dayOfWeek: 1, periodId: 'pd', subjectId: 'sb', teacherId: 'T1', teacher: { status: 'ACTIVE', userId: 'tu1' } },
              { classSectionId: 'f5b', dayOfWeek: 2, periodId: 'pd', subjectId: 'sb', teacherId: 'T1', teacher: { status: 'ACTIVE', userId: 'tu1' } },
            ]
          : [{ classSectionId: 't5b', dayOfWeek: 2, periodId: 'pd', teacherId: 'T1' }],
      ),
    );
    txMock.timetableSlot.createMany.mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
    const r = await service().copyTimetableNow(SCHOOL, ACTOR);
    expect(r).toEqual({ copied: 1, skipped: 1, nextYearClasses: 1 });
    // Effective from the START OF THE IST DAY (2026-04-01 00:00 IST), so a reader asking
    // "as of 2026-04-01" — which resolves to that same instant — sees it on day one.
    expect(txMock.timetableSlot.createMany.mock.calls[0][0].data[0]).toMatchObject({ classSectionId: 't5b', dayOfWeek: 1, effectiveFrom: new Date('2026-03-31T18:30:00.000Z') });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'session.timetable.copy' }));
  });
});
