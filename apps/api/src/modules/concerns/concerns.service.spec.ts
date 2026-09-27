import 'reflect-metadata';

/**
 * THE COMPLAINT BOX'S RULES, WHICH ARE ALL ABOUT WHO SEES WHAT.
 *
 * Every assertion here is about a leak or a lost concern, because those are
 * the only two ways this feature can really fail: a teacher reading another
 * child's complaint, or a family writing into a hole.
 */
const txMock = {
  concern: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  concernComment: { create: jest.fn(), groupBy: jest.fn() },
  student: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn() },
  school: { findFirst: jest.fn() },
  notification: { create: jest.fn() },
  notificationOutbox: { create: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { ConcernsService } from './concerns.service';
import { ApiError } from '../../common/errors/api-error';

const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FAMILY_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEACHER_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADMIN_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TEACHER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const STUDENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CONCERN_ID = '11111111-1111-4111-8111-111111111111';

const row = (over: Record<string, unknown> = {}) => ({
  id: CONCERN_ID, status: 'OPEN', category: 'BUS', audience: 'CLASS_TEACHER', title: 'Bus late twice this week',
  body: 'The bus reached the stop 25 minutes late twice this week.',
  createdAt: new Date('2026-09-21T04:00:00Z'), lastActivityAt: new Date('2026-09-21T04:00:00Z'),
  resolvedAt: null, escalatedAt: null, reopenedAt: null, readByOfficeAt: null, readByTeacherAt: null,
  raisedByRole: 'PARENT', attachmentIds: [],
  student: { id: STUDENT_ID, firstName: 'Aarav', lastName: 'Mehta', classSection: { name: 'B', grade: { name: '7' } } },
  assignedTeacher: { id: TEACHER_ID, firstName: 'Mohammed Irfan', lastName: 'Qureshi' },
  raisedBy: { name: 'Priya Mehta', email: 'priya@example.test' },
  comments: [],
  ...over,
});

let svc: ConcernsService;
beforeEach(() => {
  jest.clearAllMocks();
  svc = new ConcernsService();
  txMock.school.findFirst.mockResolvedValue({ name: 'Raffles International School' });
  txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_ID });
  txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'admin@raffles.test' }]);
  txMock.concern.findMany.mockResolvedValue([]);
  txMock.concern.count.mockResolvedValue(0);
  txMock.concern.groupBy.mockResolvedValue([]);
  txMock.concernComment.groupBy.mockResolvedValue([{ concernId: CONCERN_ID, _count: { _all: 2 } }]);
});

describe('who can see what — the query, not a filter in a screen', () => {
  it('a family sees only what it raised', async () => {
    await svc.list(SCHOOL, { kind: 'FAMILY', userId: FAMILY_USER });
    expect(txMock.concern.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL, raisedById: FAMILY_USER });
  });

  it('a teacher sees only concerns ADDRESSED to them as class teacher', async () => {
    await svc.list(SCHOOL, { kind: 'TEACHER', userId: TEACHER_USER });
    expect(txMock.concern.findMany.mock.calls[0][0].where).toMatchObject({
      schoolId: SCHOOL, audience: 'CLASS_TEACHER', assignedTeacherId: TEACHER_ID,
    });
  });

  it('a login with no teacher row sees NOTHING — never everything', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    await svc.list(SCHOOL, { kind: 'TEACHER', userId: TEACHER_USER });
    const where = txMock.concern.findMany.mock.calls[0][0].where as { assignedTeacherId: string };
    expect(where.assignedTeacherId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('the office sees what was sent to it, plus anything a teacher sent up', async () => {
    await svc.list(SCHOOL, { kind: 'ADMIN', userId: ADMIN_USER });
    expect(txMock.concern.findMany.mock.calls[0][0].where).toMatchObject({
      schoolId: SCHOOL, OR: [{ audience: 'OFFICE' }, { escalatedAt: { not: null } }],
    });
  });
});

describe('raising one', () => {
  beforeEach(() => {
    txMock.user.findFirst.mockResolvedValue({ id: FAMILY_USER, role: 'STUDENT', name: 'Priya Mehta', email: 'priya@example.test' });
    txMock.student.findFirst.mockResolvedValue({ id: STUDENT_ID, classSectionId: 'sec-7b' });
    txMock.classSection.findFirst.mockResolvedValue({ classTeacherId: TEACHER_ID, classTeacher: { id: TEACHER_ID, status: 'ACTIVE' } });
    txMock.concern.create.mockResolvedValue({ id: CONCERN_ID, audience: 'CLASS_TEACHER', assignedTeacherId: TEACHER_ID, title: 'Bus late twice this week' });
    txMock.concern.findFirst.mockResolvedValue(row());
  });

  it('snapshots the class teacher, so a later reassignment cannot move it', async () => {
    await svc.raise(SCHOOL, FAMILY_USER, { audience: 'CLASS_TEACHER', category: 'BUS', title: 'Bus late twice this week', body: 'Twice this week.' });
    expect(txMock.concern.create.mock.calls[0][0].data).toMatchObject({
      audience: 'CLASS_TEACHER', assignedTeacherId: TEACHER_ID, studentId: STUDENT_ID, raisedById: FAMILY_USER,
    });
  });

  it('falls to the office when the section has no class teacher — never addressed to nobody', async () => {
    txMock.classSection.findFirst.mockResolvedValue({ classTeacherId: null, classTeacher: null });
    await svc.raise(SCHOOL, FAMILY_USER, { audience: 'CLASS_TEACHER', category: 'BUS', title: 'Bus late', body: 'Twice.' });
    expect(txMock.concern.create.mock.calls[0][0].data).toMatchObject({ audience: 'OFFICE', assignedTeacherId: null });
  });

  it('falls to the office when that class teacher has LEFT', async () => {
    txMock.classSection.findFirst.mockResolvedValue({ classTeacherId: TEACHER_ID, classTeacher: { id: TEACHER_ID, status: 'LEFT' } });
    await svc.raise(SCHOOL, FAMILY_USER, { audience: 'CLASS_TEACHER', category: 'SAFETY', title: 'Gate', body: 'Open at 2pm.' });
    expect(txMock.concern.create.mock.calls[0][0].data).toMatchObject({ audience: 'OFFICE', assignedTeacherId: null });
  });

  it('refuses a child that is not on this login', async () => {
    txMock.student.findFirst.mockResolvedValue(null);
    await expect(
      svc.raise(SCHOOL, FAMILY_USER, { studentId: STUDENT_ID, audience: 'OFFICE', category: 'FEES', title: 'Bill', body: 'Wrong amount.' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('tells the class teacher — not every admin — when the family chose the class teacher', async () => {
    txMock.concern.findFirst.mockResolvedValue(row({ assignedTeacher: { id: TEACHER_ID, firstName: 'Mohammed Irfan', lastName: 'Qureshi', userId: TEACHER_USER } }));
    await svc.raise(SCHOOL, FAMILY_USER, { audience: 'CLASS_TEACHER', category: 'BUS', title: 'Bus late twice this week', body: 'Twice.' });
    const targets = txMock.notification.create.mock.calls.map((c) => c[0].data.userId);
    expect(targets).toEqual([TEACHER_USER]);
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data).toMatchObject({ kind: 'CONCERN_RAISED', targetUserId: TEACHER_USER });
  });
});

describe('the timeline', () => {
  it('a private note is never shown to the family', async () => {
    txMock.concern.findFirst.mockResolvedValue(row({
      comments: [
        { id: 'c1', body: 'Sorry about this.', createdAt: new Date(), visibleToFamily: true, statusFrom: null, statusTo: null, authorRole: 'TEACHER', author: { name: 'Mr Qureshi', email: 't@x.test' } },
        { id: 'c2', body: 'Driver changed without telling the office.', createdAt: new Date(), visibleToFamily: false, statusFrom: null, statusTo: null, authorRole: 'ADMIN', author: { name: 'Office', email: 'a@x.test' } },
      ],
    }));
    const family = await svc.detail(SCHOOL, { kind: 'FAMILY', userId: FAMILY_USER }, CONCERN_ID);
    expect(family.comments.map((c) => c.id)).toEqual(['c1']);
    const office = await svc.detail(SCHOOL, { kind: 'ADMIN', userId: ADMIN_USER }, CONCERN_ID);
    expect(office.comments.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('a family reply cannot be marked invisible to the family', async () => {
    txMock.concern.findFirst.mockResolvedValue(row());
    await svc.comment(SCHOOL, { kind: 'FAMILY', userId: FAMILY_USER }, CONCERN_ID, { body: 'Still late today.', visibleToFamily: false });
    expect(txMock.concernComment.create.mock.calls[0][0].data).toMatchObject({ visibleToFamily: true, authorRole: 'PARENT' });
  });

  it('a private note sends the family nothing', async () => {
    txMock.concern.findFirst.mockResolvedValue(row());
    await svc.comment(SCHOOL, { kind: 'ADMIN', userId: ADMIN_USER }, CONCERN_ID, { body: 'Check with transport.', visibleToFamily: false });
    expect(txMock.notification.create).not.toHaveBeenCalled();
  });

  it('a visible reply does tell the family', async () => {
    txMock.concern.findFirst.mockResolvedValue(row({ raisedById: FAMILY_USER }));
    await svc.comment(SCHOOL, { kind: 'ADMIN', userId: ADMIN_USER }, CONCERN_ID, { body: 'Route 4 has its driver back.' });
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data).toMatchObject({ kind: 'CONCERN_REPLIED' });
  });

  it('opening it marks it read for THAT reader only', async () => {
    txMock.concern.findFirst.mockResolvedValue(row());
    await svc.detail(SCHOOL, { kind: 'TEACHER', userId: TEACHER_USER }, CONCERN_ID);
    expect(txMock.concern.update.mock.calls[0][0].data).toHaveProperty('readByTeacherAt');
    expect(txMock.concern.update.mock.calls[0][0].data).not.toHaveProperty('readByOfficeAt');
  });

  it('a status change is an entry on the same timeline, with the move on it', async () => {
    txMock.concern.findFirst.mockResolvedValue(row({ status: 'OPEN' }));
    await svc.setStatus(SCHOOL, { kind: 'ADMIN', userId: ADMIN_USER }, CONCERN_ID, 'RESOLVED', 'Driver back from today.');
    expect(txMock.concernComment.create.mock.calls[0][0].data).toMatchObject({ statusFrom: 'OPEN', statusTo: 'RESOLVED', visibleToFamily: true });
    expect(txMock.concern.update.mock.calls[0][0].data).toMatchObject({ status: 'RESOLVED', resolvedById: ADMIN_USER });
  });

  it('a family cannot change the status', async () => {
    await expect(svc.setStatus(SCHOOL, { kind: 'FAMILY', userId: FAMILY_USER }, CONCERN_ID, 'RESOLVED')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('escalation is one way', () => {
  it('a teacher sends it up: the office gets it and the teacher keeps it', async () => {
    txMock.concern.findFirst.mockResolvedValue(row({ escalatedAt: null }));
    await svc.escalate(SCHOOL, { kind: 'TEACHER', userId: TEACHER_USER }, CONCERN_ID);
    const data = txMock.concern.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.escalatedAt).toBeInstanceOf(Date);
    // The audience is untouched, so the teacher's own scope still matches it.
    expect(data).not.toHaveProperty('audience');
    expect(data.readByOfficeAt).toBeNull();
  });

  it('only a teacher may send one up', async () => {
    await expect(svc.escalate(SCHOOL, { kind: 'ADMIN', userId: ADMIN_USER }, CONCERN_ID)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('reopening', () => {
  it('works once, inside the window', async () => {
    txMock.concern.findFirst.mockResolvedValue(row({ status: 'RESOLVED', resolvedAt: new Date(Date.now() - 2 * 86_400_000), reopenedAt: null, raisedById: FAMILY_USER }));
    await svc.reopen(SCHOOL, FAMILY_USER, CONCERN_ID, 'It happened again today.');
    expect(txMock.concern.update.mock.calls[0][0].data).toMatchObject({ status: 'OPEN', resolvedAt: null });
    expect(txMock.concernComment.create.mock.calls[0][0].data).toMatchObject({ statusFrom: 'RESOLVED', statusTo: 'OPEN' });
  });

  it('is refused after the window', async () => {
    txMock.concern.findFirst.mockResolvedValue({ id: CONCERN_ID, status: 'RESOLVED', resolvedAt: new Date(Date.now() - 30 * 86_400_000), reopenedAt: null });
    await expect(svc.reopen(SCHOOL, FAMILY_USER, CONCERN_ID, 'Again.')).rejects.toBeInstanceOf(ApiError);
  });

  it('is refused a second time', async () => {
    txMock.concern.findFirst.mockResolvedValue({ id: CONCERN_ID, status: 'RESOLVED', resolvedAt: new Date(), reopenedAt: new Date() });
    await expect(svc.reopen(SCHOOL, FAMILY_USER, CONCERN_ID, 'Again.')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('the numbers', () => {
  it('reports the MEDIAN days to resolve, so one stale concern does not define the school', async () => {
    const day = 86_400_000;
    txMock.concern.findMany.mockResolvedValue([
      { createdAt: new Date(Date.now() - 2 * day), resolvedAt: new Date(Date.now() - day) },
      { createdAt: new Date(Date.now() - 3 * day), resolvedAt: new Date(Date.now() - 2 * day) },
      { createdAt: new Date(Date.now() - 60 * day), resolvedAt: new Date() },
    ]);
    const counts = await svc.counts(SCHOOL, { kind: 'ADMIN', userId: ADMIN_USER });
    expect(counts.medianDaysToResolve).toBe(1);
    expect(counts.resolvedThisMonth).toBe(3);
  });
});
