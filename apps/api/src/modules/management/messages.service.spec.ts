const txMock = {
  student: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
  subject: { findFirst: jest.fn() },
  school: { findFirst: jest.fn() },
  messageThread: { findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  message: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  notificationOutbox: { create: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

// Keep every real @skoolos/db export (UserRole etc. are read by controllers in
// the module graph) — only withTenant is stubbed so no DB connection is made.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));
// The service imports these as VALUES for DI; stub them so loading the spec
// doesn't drag their transitive graphs in (mirrors portal.service.spec).
jest.mock('../tenancy', () => ({ TenantContextService: class {} }));
jest.mock('./timetable.service', () => ({ TimetableService: class {} }));

import { MessagesService } from './messages.service';
import type { TenantContextService } from '../tenancy';
import type { TimetableService } from './timetable.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SUBJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_SUBJECT = 'c2c2c2c2-cccc-cccc-cccc-cccccccccccc';
const TEACHER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TEACHER_USER = 'd0d0d0d0-dddd-dddd-dddd-dddddddddddd';
const STUDENT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const STUDENT_USER = 'e0e0e0e0-eeee-eeee-eeee-eeeeeeeeeeee';
const THREAD = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** One timetable slot making TEACHER teach STUDENT's section SUBJECT. */
function slot(teacherId = TEACHER, subjectId = SUBJECT) {
  return {
    id: 's1',
    dayOfWeek: 1,
    period: { id: 'p', label: '1', order: 1, startTime: '09:00', endTime: '09:45' },
    subject: { id: subjectId, name: subjectId === SUBJECT ? 'Mathematics' : 'Science', code: 'X' },
    teacher: { id: teacherId, firstName: 'Asha', lastName: 'Rao' },
    classSection: { id: SECTION, name: '8-C', grade: { name: '8' } },
  };
}

function threadRow(over: Record<string, unknown> = {}) {
  return {
    id: THREAD,
    studentId: STUDENT,
    teacherId: TEACHER,
    subjectId: SUBJECT,
    classSectionId: SECTION,
    lastMessageAt: new Date('2026-07-31T10:00:00.000Z'),
    student: { firstName: 'Ravi', lastName: 'Kumar' },
    teacher: { firstName: 'Asha', lastName: 'Rao' },
    subject: { name: 'Mathematics' },
    messages: [{ body: 'hi sir' }],
    _count: { messages: 2 },
    ...over,
  };
}

describe('MessagesService', () => {
  const tenant = { requireTenant: jest.fn() };
  const timetable = { listForClass: jest.fn() };
  const svc = new MessagesService(
    tenant as unknown as TenantContextService,
    timetable as unknown as TimetableService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    tenant.requireTenant.mockReturnValue({ schoolId: SCHOOL });
    timetable.listForClass.mockResolvedValue([slot()]);
    txMock.student.findFirst.mockResolvedValue({
      id: STUDENT,
      classSectionId: SECTION,
      firstName: 'Ravi',
      lastName: 'Kumar',
      userId: STUDENT_USER,
    });
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER,
      firstName: 'Asha',
      lastName: 'Rao',
      userId: TEACHER_USER,
    });
    txMock.school.findFirst.mockResolvedValue({ name: 'Green Valley' });
    txMock.subject.findFirst.mockResolvedValue({ name: 'Mathematics' });
    txMock.messageThread.upsert.mockResolvedValue({ id: THREAD, classSectionId: SECTION, subjectId: SUBJECT });
    txMock.messageThread.findFirst.mockResolvedValue(threadRow());
    txMock.message.findMany.mockResolvedValue([
      { id: 'm1', senderRole: 'STUDENT', body: 'hi sir', createdAt: new Date('2026-07-31T09:00:00Z'), readAt: null },
    ]);
    txMock.message.create.mockResolvedValue({ id: 'm2' });
    txMock.messageThread.update.mockResolvedValue({});
    txMock.message.updateMany.mockResolvedValue({ count: 0 });
    txMock.notificationOutbox.create.mockResolvedValue({ id: 'ob1' });
  });

  describe('messageableTeachers', () => {
    it('returns distinct (teacher, subject) pairs from the timetable', async () => {
      timetable.listForClass.mockResolvedValue([slot(), slot(), slot(TEACHER, OTHER_SUBJECT)]);
      const list = await svc.messageableTeachers(STUDENT_USER);
      expect(list).toHaveLength(2);
      expect(list.map((t) => t.subjectId).sort()).toEqual([SUBJECT, OTHER_SUBJECT].sort());
      expect(list[0].teacherName).toBe('Asha Rao');
    });

    it('a student with no section has nobody to message', async () => {
      txMock.student.findFirst.mockResolvedValue({ id: STUDENT, classSectionId: null, firstName: 'R', lastName: 'K', userId: STUDENT_USER });
      expect(await svc.messageableTeachers(STUDENT_USER)).toEqual([]);
    });
  });

  describe('studentSend — authorization (the load-bearing rule)', () => {
    it('rejects a teacher who does not teach the student at all → 403', async () => {
      timetable.listForClass.mockResolvedValue([]); // delete the authorizing slot
      await expect(
        svc.studentSend(STUDENT_USER, { teacherId: TEACHER, subjectId: SUBJECT, body: 'hi' }),
      ).rejects.toMatchObject({ response: { code: 'NOT_YOUR_TEACHER' }, status: 403 });
      expect(txMock.messageThread.upsert).not.toHaveBeenCalled();
    });

    it('rejects a subject that teacher does not teach the student, even if they teach another → 403', async () => {
      timetable.listForClass.mockResolvedValue([slot(TEACHER, OTHER_SUBJECT)]); // teaches OTHER_SUBJECT only
      await expect(
        svc.studentSend(STUDENT_USER, { teacherId: TEACHER, subjectId: SUBJECT, body: 'hi' }),
      ).rejects.toMatchObject({ response: { code: 'NOT_YOUR_TEACHER' }, status: 403 });
    });

    it('allows a send when the (teacher, subject) pair IS in the timetable', async () => {
      await expect(
        svc.studentSend(STUDENT_USER, { teacherId: TEACHER, subjectId: SUBJECT, body: 'hi sir' }),
      ).resolves.toBeDefined();
      expect(txMock.messageThread.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('studentSend — find-or-create + outbox', () => {
    const dto = { teacherId: TEACHER, subjectId: SUBJECT, body: 'question about q3' };

    it('upserts on the (student, teacher, subject) unique key — one thread, appends a message, bumps lastMessageAt', async () => {
      await svc.studentSend(STUDENT_USER, dto);
      expect(txMock.messageThread.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { one_thread_per_student_teacher_subject: { studentId: STUDENT, teacherId: TEACHER, subjectId: SUBJECT } },
        }),
      );
      expect(txMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ threadId: THREAD, senderRole: 'STUDENT', body: dto.body }) }),
      );
      expect(txMock.messageThread.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: THREAD }, data: expect.objectContaining({ lastMessageAt: expect.any(Date) }) }),
      );
    });

    it('writes ONE outbox row targeting the teacher’s login, in the same tx', async () => {
      await svc.studentSend(STUDENT_USER, dto);
      expect(txMock.notificationOutbox.create).toHaveBeenCalledTimes(1);
      expect(txMock.notificationOutbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'MESSAGE_RECEIVED', targetUserId: TEACHER_USER, classSectionId: SECTION }),
        }),
      );
    });

    it('writes NO outbox row when the teacher has no login (nobody to push)', async () => {
      txMock.teacher.findFirst.mockImplementation(({ where }: { where: { userId?: string; id?: string } }) => {
        // myTeacher lookup is by userId; the target-userId lookup is by id.
        if (where.id === TEACHER) return Promise.resolve({ userId: null });
        return Promise.resolve({ id: TEACHER, firstName: 'Asha', lastName: 'Rao', userId: TEACHER_USER });
      });
      await svc.studentSend(STUDENT_USER, dto);
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
      // the message itself is still written
      expect(txMock.message.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('teacherReply — ownership from the STORED thread', () => {
    it('rejects a reply to a thread whose teacherId is not the caller → 404 NOT_YOUR_THREAD', async () => {
      txMock.messageThread.findFirst.mockResolvedValue({ id: THREAD, teacherId: 'someone-else', studentId: STUDENT, classSectionId: SECTION, subjectId: SUBJECT });
      await expect(svc.teacherReply(TEACHER_USER, THREAD, { body: 'ok' })).rejects.toMatchObject({ response: { code: 'NOT_YOUR_THREAD' } });
      expect(txMock.message.create).not.toHaveBeenCalled();
    });

    it('appends + writes an outbox row targeting the STUDENT on a thread the teacher owns', async () => {
      // First findFirst (ownership) returns a plain owned thread; later findFirst (loadThreadForList) returns the include row.
      txMock.messageThread.findFirst
        .mockResolvedValueOnce({ id: THREAD, teacherId: TEACHER, studentId: STUDENT, classSectionId: SECTION, subjectId: SUBJECT })
        .mockResolvedValueOnce(threadRow());
      await svc.teacherReply(TEACHER_USER, THREAD, { body: 'see me after class' });
      expect(txMock.message.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ senderRole: 'TEACHER', body: 'see me after class' }) }),
      );
      expect(txMock.notificationOutbox.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kind: 'MESSAGE_RECEIVED', targetUserId: STUDENT_USER }) }),
      );
    });
  });

  describe('read-marking + ownership on open', () => {
    it('studentThread marks TEACHER→student messages read and 404s a thread that is not the caller’s', async () => {
      await svc.studentThread(STUDENT_USER, THREAD);
      expect(txMock.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ threadId: THREAD, senderRole: 'TEACHER', readAt: null }) }),
      );

      txMock.messageThread.findFirst.mockResolvedValue(threadRow({ studentId: 'not-me' }));
      await expect(svc.studentThread(STUDENT_USER, THREAD)).rejects.toMatchObject({ status: 404 });
    });

    it('teacherThread marks STUDENT→teacher messages read', async () => {
      await svc.teacherThread(TEACHER_USER, THREAD);
      expect(txMock.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ threadId: THREAD, senderRole: 'STUDENT', readAt: null }) }),
      );
    });
  });

  describe('thread list mapping', () => {
    it('maps names, preview and unread count newest-first for the student side', async () => {
      txMock.messageThread.findMany.mockResolvedValue([threadRow()]);
      const [row] = await svc.studentThreads(STUDENT_USER);
      expect(row).toMatchObject({ teacherName: 'Asha Rao', studentName: 'Ravi Kumar', subjectName: 'Mathematics', lastMessagePreview: 'hi sir', unreadCount: 2 });
      expect(txMock.messageThread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { studentId: STUDENT }, orderBy: { lastMessageAt: 'desc' } }),
      );
    });
  });
});
