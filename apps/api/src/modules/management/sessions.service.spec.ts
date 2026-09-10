import 'reflect-metadata';

const txMock = {
  academicYear: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  classSection: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  student: { groupBy: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
  sessionPlan: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  sessionDecision: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  grade: { findMany: jest.fn() },
  exam: { findMany: jest.fn() },
  attendance: { findMany: jest.fn() },
  result: { findMany: jest.fn() },
  timetableSlot: { findMany: jest.fn(), create: jest.fn() },
  registerChangeRequest: { updateMany: jest.fn() },
  school: { findUnique: jest.fn() },
  user: { findMany: jest.fn(), updateMany: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  notification: { createMany: jest.fn() },
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

import { Prisma } from '@prisma/client';
import { SessionsService } from './sessions.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const leavePolicy = { closeYear: jest.fn().mockResolvedValue({ carried: 1 }) };
const alumni = { graduateBatchIn: jest.fn().mockResolvedValue({ created: 1 }) };
const alumniAuth = { mintClaimToken: jest.fn().mockResolvedValue({ token: 'tok123', expiresAt: new Date() }) };
const features = { getFeatures: jest.fn().mockResolvedValue(new Set(['MANAGEMENT', 'ALUMNI'])) };
const mail = { sendAlumniWelcome: jest.fn().mockResolvedValue(true), sendSessionStarted: jest.fn().mockResolvedValue(true) };

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
    txMock.academicYear.findMany.mockResolvedValue([{ id: 'y1', name: '2025-26', startDate: new Date(), endDate: new Date(), isCurrent: true, _count: { classSections: 2 } }]);
    txMock.classSection.findMany.mockResolvedValue([{ id: 'f5a', academicYearId: 'y1' }]);
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
  it('bumps version and stores the section map', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', version: 3 });
    txMock.sessionPlan.update.mockResolvedValue({ id: 'p1', version: 4 });
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
    txMock.attendance.findMany.mockResolvedValue([{ studentId: 's1', status: 'PRESENT' }, { studentId: 's1', status: 'ABSENT' }, { studentId: 's2', status: 'PRESENT' }]);
    txMock.result.findMany.mockResolvedValue([{ studentId: 's1', marks: 81, examId: 'e1', exam: { maxMarks: 100 } }, { studentId: 's2', marks: 29, examId: 'e1', exam: { maxMarks: 100 } }]);
    txMock.sessionDecision.findMany.mockResolvedValue([]);
    const r = await service().sectionRows(SCHOOL, 'f5b');
    expect(r.rows[0]).toMatchObject({ studentId: 's1', attendancePct: 50, resultsPct: 81, review: false, joinedSincePlan: false, decision: null, toSectionId: 't6b', defaultDecision: 'PROMOTE', stayToSectionId: 't5b' });
    expect(r.rows[1]).toMatchObject({ studentId: 's2', resultsPct: 29, review: true, joinedSincePlan: true });
    expect(txMock.student.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE', classSectionId: 'f5b' });
    expect(r.targets.map((t) => t.label)).toEqual(['6 B', '5 B']);
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
  beforeEach(() => {
    txMock.sessionPlan.findFirst.mockResolvedValue(plan);
    txMock.classSection.findMany.mockResolvedValue([
      { id: 'f5b', gradeId: 'g5', name: 'B', academicYearId: 'y1', classTeacherId: 'T1', grade: { name: '5' } },
      { id: 't6b', gradeId: 'g6', name: 'B', academicYearId: 'y2', classTeacherId: 'T1', grade: { name: '6' } },
      { id: 't5b', gradeId: 'g5', name: 'B', academicYearId: 'y2', classTeacherId: null, grade: { name: '5' } },
    ]);
    txMock.student.findMany.mockResolvedValue([
      { id: 's1', userId: 'u1', firstName: 'Aarav', lastName: 'M', admissionNo: '1', rollNo: '1', classSectionId: 'f5b' },
      { id: 's2', userId: 'u2', firstName: 'Dev', lastName: 'S', admissionNo: '2', rollNo: '2', classSectionId: 'f5b' },
    ]);
    txMock.sessionDecision.findMany.mockResolvedValue([
      { studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' },
      { studentId: 's2', decision: 'PASS_OUT', toSectionId: null },
    ]);
    txMock.student.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, userId: where.id === 's1' ? 'u1' : 'u2', status: 'ACTIVE' }),
    );
    txMock.student.update.mockResolvedValue({});
    txMock.timetableSlot.findMany.mockResolvedValue([
      { classSectionId: 'f5b', dayOfWeek: 1, periodId: 'pd', subjectId: 'sb', teacherId: 'T1', teacher: { status: 'ACTIVE', userId: 'tu1' } },
      { classSectionId: 'f5b', dayOfWeek: 2, periodId: 'pd', subjectId: 'sb', teacherId: 'T9', teacher: { status: 'LEFT', userId: 'tu9' } },
    ]);
    txMock.registerChangeRequest.updateMany.mockResolvedValue({ count: 0 });
    txMock.user.findMany.mockResolvedValue([{ id: 'u1', email: 'family@x.in' }]);
    txMock.alumni.findMany.mockResolvedValue([{ id: 'al2', email: 'dev@x.in' }]);
  });

  it('refuses on version mismatch and on undecided students', async () => {
    await expect(service().start(SCHOOL, ACTOR, { when: 'NOW', version: 3 })).rejects.toMatchObject({ response: { code: 'PLAN_CHANGED' } });
    txMock.sessionDecision.findMany.mockResolvedValue([{ studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' }]);
    await expect(service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 })).rejects.toMatchObject({ response: { code: 'UNDECIDED_STUDENTS' } });
    expect(txMock.student.update).not.toHaveBeenCalled();
  });

  it('moves seats, makes alumni, closes their login, flips the year, copies the timetable for active teachers, carries leave, tells families', async () => {
    const r = await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    await Promise.all(background);
    expect(r).toMatchObject({ started: true, moved: 1, alumni: 1, left: 0, slotsCopied: 1, slotsSkipped: 1 });
    expect(alumni.graduateBatchIn).toHaveBeenCalledWith(txMock, SCHOOL, { classSectionIds: ['f5b'], batchYear: 2026 });
    expect(txMock.student.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ classSectionId: 't6b', rollNo: '1' }) }));
    expect(txMock.student.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's2' }, data: expect.objectContaining({ status: 'ALUMNI', alumniBatch: '2025-26', isActive: false }) }));
    expect(txMock.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u2', schoolId: SCHOOL }, data: { isActive: false } });
    expect(txMock.academicYear.update).toHaveBeenCalledWith({ where: { id: 'y1' }, data: { isCurrent: false } });
    expect(txMock.academicYear.update).toHaveBeenCalledWith({ where: { id: 'y2' }, data: { isCurrent: true } });
    expect(txMock.timetableSlot.create).toHaveBeenCalledTimes(1);
    // The timetable follows the CLASSROOM, not the children: 5 B's periods become next year's 5 B.
    expect(txMock.timetableSlot.create.mock.calls[0][0].data).toMatchObject({ classSectionId: 't5b', academicYearId: 'y2', teacherId: 'T1' });
    expect(txMock.registerChangeRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
    expect(leavePolicy.closeYear).toHaveBeenCalledWith(SCHOOL, 'y1', 'y2');
    expect(txMock.sessionPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'STARTED' }) }));
    expect(txMock.sessionDecision.update).toHaveBeenCalledTimes(2);
    // The bell: the family and the teacher whose class was copied.
    expect(txMock.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ userId: 'u1', kind: 'SESSION', title: 'Aarav is in 6 B for 2026-27' })] }));
    expect(txMock.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ userId: 'tu1', kind: 'SESSION' })] }));
    // The mails, after commit: the family's new class and the alumnus's door.
    expect(mail.sendSessionStarted).toHaveBeenCalledWith('family@x.in', 'Raffles', 'Aarav', '6 B', '2026-27', SCHOOL);
    expect(alumniAuth.mintClaimToken).toHaveBeenCalledWith(SCHOOL, 'al2');
    expect(mail.sendAlumniWelcome).toHaveBeenCalledWith('dev@x.in', 'Raffles', 'https://raffles.sckools.com/alumni#claim=tok123', SCHOOL);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'session.start' }));
  });

  it('skips graduation and the alumni mail when the school has no Alumni wing', async () => {
    features.getFeatures.mockResolvedValue(new Set(['MANAGEMENT']));
    await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    await Promise.all(background);
    expect(alumni.graduateBatchIn).not.toHaveBeenCalled();
    expect(mail.sendAlumniWelcome).not.toHaveBeenCalled();
    // The child still leaves as ALUMNI in the school's own records.
    expect(txMock.student.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's2' }, data: expect.objectContaining({ status: 'ALUMNI' }) }));
  });

  it('refuses when a promoted child points at a class that no longer exists', async () => {
    txMock.sessionDecision.findMany.mockResolvedValue([{ studentId: 's1', decision: 'PROMOTE', toSectionId: 'gone' }, { studentId: 's2', decision: 'PASS_OUT', toSectionId: null }]);
    await expect(service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 })).rejects.toMatchObject({ response: { code: 'BAD_TARGET' } });
  });

  it('a leave carry-forward failure after commit is logged, not thrown', async () => {
    leavePolicy.closeYear.mockRejectedValueOnce(new Error('boom'));
    const r = await service().start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    expect(r).toMatchObject({ started: true });
  });

  it('ON_START_DATE schedules at the school midnight instead of applying', async () => {
    const r = await service().start(SCHOOL, ACTOR, { when: 'ON_START_DATE', version: 4 });
    expect(r).toEqual({ scheduled: true, scheduledFor: '2026-03-31T18:30:00.000Z' });
    expect(txMock.sessionPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) }));
    expect(txMock.student.update).not.toHaveBeenCalled();
  });
});

describe('register and the cron', () => {
  it('register joins decisions with names and section labels', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'STARTED', fromYearId: 'y1', toYearId: 'y2' });
    txMock.sessionDecision.findMany.mockResolvedValue([
      { studentId: 's1', decision: 'PROMOTE', fromSectionId: 'f5b', toSectionId: 't6b', leaveStatus: null, decidedById: 'u9', appliedAt: new Date('2026-04-01'), student: { firstName: 'Aarav', lastName: 'Mehta', admissionNo: '1' } },
    ]);
    txMock.classSection.findMany.mockResolvedValue([{ id: 'f5b', name: 'B', grade: { name: '5' } }, { id: 't6b', name: 'B', grade: { name: '6' } }]);
    txMock.user.findMany.mockResolvedValue([{ id: 'u9', email: 'office@x.in' }]);
    const r = await service().register(SCHOOL, 'y1');
    expect(r[0]).toMatchObject({ name: 'Aarav Mehta', fromSection: '5 B', toSection: '6 B', decision: 'PROMOTE', decidedBy: 'office@x.in' });
  });

  it('register is empty for a year that was never closed through a plan', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue(null);
    expect(await service().register(SCHOOL, 'y0')).toEqual([]);
  });

  it('startDue starts every scheduled plan whose time has come, as the person who scheduled it', async () => {
    platformMock.sessionPlan.findMany.mockResolvedValue([{ id: 'p1', schoolId: SCHOOL, createdById: 'u1' }]);
    const svc = service();
    const outcome = { moved: 0, alumni: 0, left: 0, slotsCopied: 0, slotsSkipped: 0, alumniDoor: false, alumniStudentIds: [], teacherUserIds: [], familyUserIds: [], sessionName: '2026-27', schoolName: 'R', schoolSlug: 'r', carryLeave: false, fromYearId: 'y1', toYearId: 'y2' };
    const apply = jest.spyOn(svc as never, 'applyPlan' as never).mockResolvedValue(outcome as never);
    const after = jest.spyOn(svc as never, 'afterStart' as never).mockResolvedValue(undefined as never);
    const r = await svc.startDue(new Date('2026-03-31T18:31:00Z'));
    expect(platformMock.sessionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'SCHEDULED', scheduledFor: { lte: new Date('2026-03-31T18:31:00Z') } } }));
    expect(apply).toHaveBeenCalledWith(SCHOOL, 'u1', 'p1');
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
