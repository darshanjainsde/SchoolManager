const txMock = {
  classSection: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  substitution: { findFirst: jest.fn() },
  school: { findFirst: jest.fn() },
  student: { findMany: jest.fn(), findFirst: jest.fn(), groupBy: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  diaryEntry: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  diaryAck: {
    createMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  notification: { createMany: jest.fn() },
  // resolveStudentRecipients joins Student -> User for the email address.
  user: { findMany: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

const istTodayMock = jest.fn(() => '2026-08-03');
jest.mock('./internal/timetable-date', () => ({
  ...jest.requireActual('./internal/timetable-date'),
  istTodayISO: () => istTodayMock(),
}));

// Runs the fire-and-forget email work inline so the test can await it.
const backgroundJobs: Array<() => Promise<unknown>> = [];
jest.mock('../../common/notifications/run-in-background', () => ({
  runInBackground: (work: () => Promise<unknown>) => {
    backgroundJobs.push(work);
  },
}));

import { DiaryService } from './diary.service';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { CreateDiaryEntryDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const TID = 'teacher-1';
const SECTION = 'sec-8c';
const TODAY = '2026-08-03';
const YESTERDAY = '2026-08-02';
const AARAV = 'stu-aarav';
const DIYA = 'stu-diya';

const dto = (over: Partial<CreateDiaryEntryDto> = {}): CreateDiaryEntryDto =>
  ({
    classSectionId: SECTION,
    date: TODAY,
    kind: 'ITEM',
    body: 'Maths worksheet 7.3, pages 40–41.',
    ...over,
  }) as CreateDiaryEntryDto;

async function flushBackground() {
  const jobs = backgroundJobs.splice(0);
  for (const job of jobs) await job();
}

describe('DiaryService', () => {
  const notifications = { notify: jest.fn() };
  const svc = new DiaryService(notifications as unknown as NotificationService);

  beforeEach(() => {
    jest.clearAllMocks();
    backgroundJobs.length = 0;
    istTodayMock.mockReturnValue(TODAY);
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.teacher.findMany.mockResolvedValue([
      { id: TID, firstName: 'Meera', lastName: 'Iyer' },
    ]);
    txMock.classSection.findFirst.mockResolvedValue({
      id: SECTION,
      name: 'C',
      grade: { name: '8' },
    });
    // The live roster, counted scoped to this school rather than aggregated
    // across every school's students — see common/lists/relation-counts.ts.
    txMock.student.count.mockResolvedValue(28);
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles Public School' });
    txMock.student.findMany.mockResolvedValue([]);
    txMock.diaryEntry.findMany.mockResolvedValue([]);
    txMock.diaryAck.createMany.mockResolvedValue({ count: 0 });
    txMock.notification.createMany.mockResolvedValue({ count: 0 });
    txMock.user.findMany.mockResolvedValue([]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });
  });

  describe('create', () => {
    it('writes a whole-class ITEM with no per-student rows and tells every family', async () => {
      txMock.diaryEntry.create.mockResolvedValue({
        id: 'e1',
        kind: 'ITEM',
        audience: 'ALL',
        body: dto().body,
        subjectId: null,
        subject: null,
        createdAt: new Date('2026-08-03T09:00:00Z'),
      });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);

      const row = await svc.create(SCHOOL, USER, 'TEACHER', dto());

      expect(row.audience).toBe('ALL');
      expect(row.students).toEqual([]);
      expect(row.recipientCount).toBe(28); // the live roster, not a stored list
      expect(txMock.diaryEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ recipients: expect.anything() }),
        }),
      );
      // The bell fires in the SAME transaction as the entry.
      expect(txMock.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ userId: 'u1', kind: 'DIARY', linkId: 'e1' }),
          expect.objectContaining({ userId: 'u2', kind: 'DIARY', linkId: 'e1' }),
        ],
      });
      // An ITEM is not a remark: no email goes out.
      await flushBackground();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('emails the parent of every named child when a REMARK is written — always', async () => {
      txMock.student.findMany
        // roster check for the named children
        .mockResolvedValueOnce([{ id: AARAV, firstName: 'Aarav', lastName: 'Sharma' }])
        // linked logins for the bell
        .mockResolvedValueOnce([{ id: AARAV, userId: 'u1' }])
        // resolveStudentRecipients, inside the background job
        .mockResolvedValueOnce([
          { userId: 'u1', firstName: 'Aarav', lastName: 'Sharma' },
        ]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u1', email: 'priya@example.com' }]);
      txMock.diaryEntry.create.mockResolvedValue({
        id: 'e2',
        kind: 'REMARK',
        audience: 'SELECTED',
        body: 'Disrupted the lesson twice today.',
        subjectId: null,
        subject: null,
        createdAt: new Date('2026-08-03T10:00:00Z'),
      });

      const row = await svc.create(
        SCHOOL,
        USER,
        'TEACHER',
        dto({ kind: 'REMARK', body: 'Disrupted the lesson twice today.', studentIds: [AARAV] }),
      );

      expect(row.kind).toBe('REMARK');
      expect(row.audience).toBe('SELECTED'); // a remark is never addressed to all
      expect(row.students).toEqual([{ studentId: AARAV, name: 'Aarav Sharma' }]);

      await flushBackground();
      expect(notifications.notify).toHaveBeenCalledWith('DIARY_REMARK', [
        expect.objectContaining({
          email: 'priya@example.com',
          schoolId: SCHOOL,
          payload: expect.objectContaining({
            studentName: 'Aarav Sharma',
            teacherName: 'Meera Iyer',
            remark: 'Disrupted the lesson twice today.',
          }),
        }),
      ]);
    });

    it('refuses a remark about nobody', async () => {
      await expect(
        svc.create(SCHOOL, USER, 'TEACHER', dto({ kind: 'REMARK', studentIds: [] })),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(txMock.diaryEntry.create).not.toHaveBeenCalled();
    });

    it('refuses to name a child from another class', async () => {
      // Only one of the two ids comes back from the roster-scoped query.
      txMock.student.findMany.mockResolvedValueOnce([
        { id: AARAV, firstName: 'Aarav', lastName: 'Sharma' },
      ]);

      await expect(
        svc.create(
          SCHOOL,
          USER,
          'TEACHER',
          dto({ kind: 'REMARK', studentIds: [AARAV, DIYA] }),
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(txMock.diaryEntry.create).not.toHaveBeenCalled();
    });

    it('refuses to write into a past page', async () => {
      await expect(
        svc.create(SCHOOL, USER, 'TEACHER', dto({ date: YESTERDAY })),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    });
  });

  describe('update / remove', () => {
    it('refuses to edit yesterday, even for the author', async () => {
      txMock.diaryEntry.findFirst.mockResolvedValue({
        id: 'e1',
        date: new Date(`${YESTERDAY}T00:00:00.000Z`),
        authorTeacherId: TID,
      });

      await expect(
        svc.update(SCHOOL, USER, 'TEACHER', 'e1', { body: 'reworded' }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(txMock.diaryEntry.update).not.toHaveBeenCalled();
    });

    it('refuses to let another teacher rewrite the entry', async () => {
      txMock.diaryEntry.findFirst.mockResolvedValue({
        id: 'e1',
        date: new Date(`${TODAY}T00:00:00.000Z`),
        authorTeacherId: 'teacher-someone-else',
      });

      await expect(
        svc.update(SCHOOL, USER, 'TEACHER', 'e1', { body: 'reworded' }),
      ).rejects.toMatchObject({ response: { code: 'CLASS_NOT_OWNED' } });
    });

    it('lets the author strike out today’s line', async () => {
      txMock.diaryEntry.findFirst.mockResolvedValue({
        id: 'e1',
        date: new Date(`${TODAY}T00:00:00.000Z`),
        authorTeacherId: TID,
      });

      await svc.remove(SCHOOL, USER, 'TEACHER', 'e1');
      expect(txMock.diaryEntry.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });
  });

  describe('the family’s side', () => {
    it('reads only this child’s entries and records a read receipt', async () => {
      txMock.student.findFirst.mockResolvedValue({ id: AARAV, classSectionId: SECTION });
      txMock.diaryEntry.findMany.mockResolvedValue([
        {
          id: 'e1',
          date: new Date(`${TODAY}T00:00:00.000Z`),
          kind: 'REMARK',
          audience: 'SELECTED',
          body: 'Please sign.',
          subject: null,
          authorTeacherId: TID,
          acks: [],
          recipients: [{ id: 'r1' }],
          createdAt: new Date('2026-08-03T10:00:00Z'),
        },
      ]);

      const out = await svc.studentDiary(SCHOOL, 'user-aarav');

      expect(out.entries[0].personal).toBe(true);
      expect(out.unsignedCount).toBe(1);
      // The visibility rule is in the QUERY, not in a post-filter.
      expect(txMock.diaryEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            classSectionId: SECTION,
            OR: [{ audience: 'ALL' }, { recipients: { some: { studentId: AARAV } } }],
          }),
        }),
      );
      expect(txMock.diaryAck.createMany).toHaveBeenCalledWith({
        data: [{ schoolId: SCHOOL, entryId: 'e1', studentId: AARAV }],
        skipDuplicates: true,
      });
    });

    it('signing is idempotent — the first signature stands', async () => {
      txMock.student.findFirst.mockResolvedValue({ id: AARAV, classSectionId: SECTION });
      txMock.diaryEntry.findFirst.mockResolvedValue({ id: 'e1' });
      const firstSignedAt = new Date('2026-08-03T18:00:00Z');
      txMock.diaryAck.findFirst.mockResolvedValue({
        id: 'a1',
        signedAt: firstSignedAt,
        signedName: 'Priya Sharma',
      });
      txMock.diaryEntry.findMany.mockResolvedValue([]);

      const out = await svc.sign(SCHOOL, 'user-aarav', 'e1', 'Someone Else');

      expect(out.signedName).toBe('Priya Sharma');
      expect(out.signedAt).toBe(firstSignedAt.toISOString());
      expect(txMock.diaryAck.update).not.toHaveBeenCalled();
    });

    it('refuses to sign an entry that is not in this child’s diary', async () => {
      txMock.student.findFirst.mockResolvedValue({ id: AARAV, classSectionId: SECTION });
      txMock.diaryEntry.findFirst.mockResolvedValue(null);

      await expect(svc.sign(SCHOOL, 'user-aarav', 'e-other', 'Priya')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
    });
  });
});
