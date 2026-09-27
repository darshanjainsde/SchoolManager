const txMock = {
  classSection: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  substitution: { findFirst: jest.fn() },
  school: { findFirst: jest.fn(), findUnique: jest.fn() },
  // The month grid asks the school calendar which days it was open.
  holiday: { findMany: jest.fn() },
  academicYear: { findFirst: jest.fn() },
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

// ── the month grid ───────────────────────────────────────────────────────────

describe('studentDiary, asked for a month', () => {
  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(() => {
    jest.clearAllMocks();
    txMock.student.findFirst.mockResolvedValue({ id: 's1', classSectionId: 'c1' });
    txMock.diaryAck.createMany.mockResolvedValue({ count: 0 });
    txMock.teacher.findMany.mockResolvedValue([{ id: 't1', firstName: 'Rajeshwari', lastName: 'Balasubramanian' }]);
    // Monday to Saturday, so Sunday is the weekly closure.
    txMock.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] });
    txMock.holiday.findMany.mockResolvedValue([
      { name: 'Ganesh Chaturthi break', startDate: new Date('2026-09-21T00:00:00Z'), endDate: new Date('2026-09-22T00:00:00Z') },
    ]);
    txMock.academicYear.findFirst.mockResolvedValue({
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2027-03-31T00:00:00Z'),
    });
    txMock.diaryEntry.findMany.mockResolvedValue([
      { id: 'd1', date: new Date('2026-09-17T00:00:00Z'), kind: 'REMARK', body: 'Geometry box', authorTeacherId: 't1', audience: 'SELECTED', subject: null, acks: [], recipients: [{ id: 'r1' }], createdAt: new Date('2026-09-17T09:00:00Z') },
      { id: 'd2', date: new Date('2026-09-17T00:00:00Z'), kind: 'ITEM', body: 'Exercise 7.2', authorTeacherId: 't1', audience: 'ALL', subject: { name: 'Mathematics' }, acks: [], recipients: [], createdAt: new Date('2026-09-17T09:05:00Z') },
      { id: 'd3', date: new Date('2026-09-02T00:00:00Z'), kind: 'REMARK', body: 'Signed already', authorTeacherId: 't1', audience: 'SELECTED', subject: null, acks: [{ signedAt: new Date('2026-09-03T05:00:00Z'), signedName: 'Amma' }], recipients: [{ id: 'r2' }], createdAt: new Date('2026-09-02T09:00:00Z') },
    ]);
  });

  const notifications = { notify: jest.fn() };
  const svc = () => new DiaryService(notifications as unknown as NotificationService);

  it('returns one square per calendar day, closed days included', async () => {
    const out = await svc().studentDiary(SCHOOL, USER, undefined, '2026-09');
    expect(out.month?.days).toHaveLength(30);
    expect(out.month?.days[0].date).toBe('2026-09-01');
    expect(out.month?.days[29].date).toBe('2026-09-30');
  });

  it('says WHY a day was empty — the holiday by name, the weekly closure by weekday', async () => {
    // A blank square is the answer the list could never give. "Ganesh
    // Chaturthi break" tells a parent something; "Sunday" tells them the
    // other thing; and a school day with nothing written is neither.
    const days = (await svc().studentDiary(SCHOOL, USER, undefined, '2026-09')).month!.days;
    const on = (d: string) => days.find((x) => x.date === d)!;
    expect(on('2026-09-21').offReason).toBe('Ganesh Chaturthi break');
    expect(on('2026-09-22').offReason).toBe('Ganesh Chaturthi break');
    expect(on('2026-09-06').offReason).toBe('Sunday');
    expect(on('2026-09-07').offReason).toBeNull();
  });

  it('counts what is on a day, and separates the remarks still to sign', async () => {
    const days = (await svc().studentDiary(SCHOOL, USER, undefined, '2026-09')).month!.days;
    const on = (d: string) => days.find((x) => x.date === d)!;
    expect(on('2026-09-17')).toMatchObject({ items: 1, remarks: 1, unsigned: 1 });
    // Signed, so it still shows as something on the day but asks for nothing.
    expect(on('2026-09-02')).toMatchObject({ items: 0, remarks: 1, unsigned: 0 });
    expect(on('2026-09-08')).toMatchObject({ items: 0, remarks: 0, unsigned: 0 });
  });

  it('reads the whole month in ONE query, so opening a date costs nothing', async () => {
    await svc().studentDiary(SCHOOL, USER, undefined, '2026-09');
    expect(txMock.diaryEntry.findMany).toHaveBeenCalledTimes(1);
    const where = txMock.diaryEntry.findMany.mock.calls[0][0].where;
    expect(where.date.gte.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(where.date.lte.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('bounds the arrows to the session', async () => {
    const m = (await svc().studentDiary(SCHOOL, USER, undefined, '2026-09')).month!;
    expect(m.firstMonth).toBe('2026-04');
    expect(m.lastMonth).toBe('2027-03');
  });

  it('leaves the undated call exactly as it was — the app and /me/home use it', async () => {
    const out = await svc().studentDiary(SCHOOL, USER);
    expect(out.month).toBeUndefined();
    expect(txMock.school.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a month that is not YYYY-MM rather than guessing one', async () => {
    await expect(svc().studentDiary(SCHOOL, USER, undefined, '2026-9')).rejects.toBeTruthy();
    await expect(svc().studentDiary(SCHOOL, USER, undefined, '2026-13')).rejects.toBeTruthy();
  });
});
