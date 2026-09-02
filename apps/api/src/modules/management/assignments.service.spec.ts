const txMock = {
  classSection: { findFirst: jest.fn() },
  assignment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
  school: { findFirst: jest.fn() },
  subject: { findFirst: jest.fn() },
  notificationOutbox: { create: jest.fn() },
  student: { findMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  assignmentSeen: { groupBy: jest.fn().mockResolvedValue([]) },
  notification: { createMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { AssignmentsService, MAX_ATTACHMENT_BYTES } from './assignments.service';
import type { AttendanceService } from './attendance.service';
import type { StorageService } from '../../common/storage/storage.service';
import type { CreateAssignmentDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SUBJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CALLER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ASSIGNMENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
/** A class section distinct from `CLASS_SECTION` — never in the caller's `myClassSections`. */
const OTHER_SECTION = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

describe('AssignmentsService', () => {
  const attendance = { myClassSections: jest.fn() };
  const storage = { upload: jest.fn() };
  const svc = new AssignmentsService(
    attendance as unknown as AttendanceService,
    storage as unknown as StorageService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    txMock.school.findFirst.mockResolvedValue({ name: 'Green Valley School' });
    txMock.subject.findFirst.mockResolvedValue({ name: 'Mathematics' });
    txMock.notificationOutbox.create.mockResolvedValue({ id: 'outbox-1' });
    txMock.student.findMany.mockResolvedValue([]);
    txMock.notification.createMany.mockResolvedValue({ count: 0 });
    // Most existing tests call as SCHOOL_ADMIN (unrestricted); this default
    // only matters for the TEACHER-ownership tests below, which override it.
    attendance.myClassSections.mockResolvedValue([]);
  });

  describe('create', () => {
    const dto: CreateAssignmentDto = {
      classSectionId: CLASS_SECTION,
      subjectId: SUBJECT,
      title: 'Worksheet 3',
      instructions: 'Complete questions 1-10.',
      dueDate: '2026-08-05',
    };

    it('validates the classSection belongs to the school and sets createdByTeacherId from the caller', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION, name: '8-C' });
      txMock.assignment.create.mockResolvedValue({
        id: ASSIGNMENT_ID,
        ...dto,
        dueDate: new Date(dto.dueDate),
        attachments: [],
        createdByTeacherId: CALLER,
        createdAt: new Date('2026-07-30T00:00:00.000Z'),
      });

      const result = await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);

      expect(txMock.classSection.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, id: CLASS_SECTION } });
      expect(txMock.assignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          schoolId: SCHOOL,
          classSectionId: CLASS_SECTION,
          subjectId: SUBJECT,
          title: 'Worksheet 3',
          instructions: 'Complete questions 1-10.',
          createdByTeacherId: CALLER,
        }),
      });
      expect(result).toEqual(expect.objectContaining({ id: ASSIGNMENT_ID, seenCount: 0 }));
    });

    it('stores an empty attachments array when none is supplied', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION, name: '8-C' });
      txMock.assignment.create.mockResolvedValue({
        id: ASSIGNMENT_ID,
        ...dto,
        dueDate: new Date(dto.dueDate),
        attachments: [],
        createdByTeacherId: CALLER,
        createdAt: new Date('2026-07-30T00:00:00.000Z'),
      });

      await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);

      expect(txMock.assignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attachments: [] }),
      });
    });

    it('round-trips supplied attachments verbatim', async () => {
      const attachments = [{ url: 'https://x/y.pdf', name: 'worksheet.pdf', kind: 'pdf' as const }];
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION, name: '8-C' });
      txMock.assignment.create.mockResolvedValue({
        id: ASSIGNMENT_ID,
        ...dto,
        attachments,
        dueDate: new Date(dto.dueDate),
        createdByTeacherId: CALLER,
        createdAt: new Date('2026-07-30T00:00:00.000Z'),
      });

      await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', { ...dto, attachments });

      expect(txMock.assignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attachments }),
      });
    });

    it('throws ApiError CLASS_NOT_FOUND for a foreign/invalid classSectionId and never creates the assignment', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null);

      await expect(svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto)).rejects.toMatchObject({
        response: { code: 'CLASS_NOT_FOUND' },
      });
      expect(txMock.assignment.create).not.toHaveBeenCalled();
    });
  });

  // Transactional outbox: `create()` writes a NotificationOutbox row IN THE
  // SAME `withTenant` transaction as the Assignment row, so a posted
  // assignment is never visible without its outbox row (and a rolled-back
  // transaction leaves no orphan row either). Deletion-proof: delete the
  // `tx.notificationOutbox.create` call from `create()` and the first test
  // below fails.
  describe('create — NotificationOutbox (transactional outbox)', () => {
    const dto: CreateAssignmentDto = {
      classSectionId: CLASS_SECTION,
      subjectId: SUBJECT,
      title: 'Worksheet 3',
      instructions: 'Complete questions 1-10.',
      dueDate: '2026-08-05',
    };

    beforeEach(() => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION, name: '8-C' });
      txMock.assignment.create.mockResolvedValue({
        id: ASSIGNMENT_ID,
        ...dto,
        dueDate: new Date(dto.dueDate),
        attachments: [],
        createdByTeacherId: CALLER,
        createdAt: new Date('2026-07-30T00:00:00.000Z'),
      });
    });

    it('writes an ASSIGNMENT_POSTED outbox row in the SAME transaction as the assignment, with a fully denormalised payload', async () => {
      await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);

      expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({
        data: {
          schoolId: SCHOOL,
          kind: 'ASSIGNMENT_POSTED',
          classSectionId: CLASS_SECTION,
          payload: {
            schoolName: 'Green Valley School',
            subjectName: 'Mathematics',
            assignmentTitle: 'Worksheet 3',
            dueDate: 'Wed, 5 Aug 2026',
            classSectionName: '8-C',
          },
        },
      });
      // Both writes happened via the SAME `withTenant` call (the mutation
      // transaction) — there is no second, separate transaction here (unlike
      // ExamsService, assignments have no best-effort real-time email path).
      expect(withTenantMock).toHaveBeenCalledTimes(1);
      expect(txMock.notificationOutbox.create.mock.invocationCallOrder[0]).toBeGreaterThan(
        txMock.assignment.create.mock.invocationCallOrder[0],
      );
    });

    it('rolls back the assignment write when the outbox write itself fails — same transaction, same fate', async () => {
      txMock.notificationOutbox.create.mockRejectedValue(new Error('db exploded'));

      await expect(svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto)).rejects.toThrow('db exploded');
    });
  });

  describe('list', () => {
    it('splits assignments into upcoming and past ordered by dueDate', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      const now = new Date('2026-07-21T12:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);

      const base = {
        classSectionId: CLASS_SECTION,
        subjectId: SUBJECT,
        title: 'Worksheet',
        instructions: 'Do it.',
        attachments: [],
        createdByTeacherId: CALLER,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      };
      txMock.assignment.findMany.mockResolvedValue([
        { id: 'a1', ...base, dueDate: new Date('2026-07-10T00:00:00.000Z'), _count: { seen: 0 } }, // past
        { id: 'a2', ...base, dueDate: new Date('2026-08-05T00:00:00.000Z'), _count: { seen: 2 } }, // future
      ]);

      const result = await svc.list(SCHOOL, CLASS_SECTION, CALLER, 'SCHOOL_ADMIN');

      expect(result.past.map((a) => a.id)).toEqual(['a1']);
      expect(result.upcoming.map((a) => a.id)).toEqual(['a2']);
      expect(txMock.assignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { schoolId: SCHOOL, classSectionId: CLASS_SECTION },
          orderBy: [{ dueDate: 'asc' }],
        }),
      );

      jest.useRealTimers();
    });

    // The real differentiator: dueDate is stored as UTC midnight for its
    // calendar date (Prisma `@db.Date`). A NAIVE `dueDate >= now` (full
    // datetime, not calendar-date) comparison would wrongly bucket a
    // same-IST-day assignment as "past" once the wall clock has moved past
    // that UTC-midnight instant — which happens for MOST of every IST day,
    // since IST is UTC+5:30 (midnight UTC is already 5:30am IST). This test
    // pins "now" well after the dueDate's raw UTC instant but still on the
    // SAME IST calendar day, so only a calendar-date (not datetime)
    // comparison passes it.
    it('an assignment due TODAY (IST) counts as upcoming, even hours after its stored UTC-midnight instant', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      // IST day 2026-07-22 spans UTC [2026-07-21T18:30, 2026-07-22T18:30).
      const now = new Date('2026-07-22T10:00:00.000Z'); // 2026-07-22 15:30 IST
      jest.useFakeTimers().setSystemTime(now);

      txMock.assignment.findMany.mockResolvedValue([
        {
          id: 'due-today',
          classSectionId: CLASS_SECTION,
          subjectId: SUBJECT,
          title: 'Worksheet',
          instructions: 'Do it.',
          attachments: [],
          createdByTeacherId: CALLER,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-07-22T00:00:00.000Z'), // due today's calendar date, but its raw instant is BEFORE "now"
          _count: { seen: 0 },
        },
      ]);

      const result = await svc.list(SCHOOL, CLASS_SECTION, CALLER, 'SCHOOL_ADMIN');

      expect(result.upcoming.map((a) => a.id)).toEqual(['due-today']);
      expect(result.past).toEqual([]);

      jest.useRealTimers();
    });

    it('includes each row\'s seenCount from the same query, never a second round trip', async () => {
      // The clock is pinned because this test asserts on `upcoming`, which is
      // decided by comparing the fixture's dueDate against NOW. Without it the
      // fixture silently expires: it passed every day until 2026-09-01 and
      // began failing on the 2nd, in a module nobody had touched for weeks.
      jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.assignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          classSectionId: CLASS_SECTION,
          subjectId: SUBJECT,
          title: 'Worksheet',
          instructions: 'Do it.',
          attachments: [],
          createdByTeacherId: CALLER,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-09-01T00:00:00.000Z'),
        },
      ]);
      txMock.assignmentSeen.groupBy.mockResolvedValue([
        { assignmentId: 'a1', _count: { _all: 7 } },
      ]);

      const result = await svc.list(SCHOOL, CLASS_SECTION, CALLER, 'SCHOOL_ADMIN');

      expect(result.upcoming[0].seenCount).toBe(7);
      // Read receipts must be counted with a schoolId predicate. Prisma's
      // `include: { _count }` compiles to `WHERE 1=1` over the whole table, so
      // asserting its ABSENCE is what keeps that regression from returning.
      expect(txMock.assignment.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ include: expect.anything() }),
      );
      expect(txMock.assignmentSeen.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ schoolId: SCHOOL }),
        }),
      );

      jest.useRealTimers();
    });

    it('throws ApiError CLASS_NOT_FOUND for a foreign/invalid classSectionId', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null);

      await expect(svc.list(SCHOOL, 'does-not-exist', CALLER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'CLASS_NOT_FOUND' },
      });
      expect(txMock.assignment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the assignment when the caller owns its stored classSectionId', async () => {
      txMock.assignment.findFirst.mockResolvedValue({ classSectionId: CLASS_SECTION });
      txMock.assignment.delete.mockResolvedValue({});

      await expect(svc.remove(SCHOOL, ASSIGNMENT_ID, CALLER, 'SCHOOL_ADMIN')).resolves.toEqual({ ok: true });
      expect(txMock.assignment.delete).toHaveBeenCalledWith({ where: { id: ASSIGNMENT_ID } });
    });

    it('throws ApiError NOT_FOUND for a foreign/invalid assignment id and never deletes', async () => {
      txMock.assignment.findFirst.mockResolvedValue(null);

      await expect(svc.remove(SCHOOL, 'does-not-exist', CALLER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      expect(txMock.assignment.delete).not.toHaveBeenCalled();
    });

    it('resolves ownership from the STORED row\'s classSectionId, not a caller-supplied one (the endpoint takes none)', async () => {
      txMock.assignment.findFirst.mockResolvedValue({ classSectionId: CLASS_SECTION });
      txMock.assignment.delete.mockResolvedValue({});
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_SECTION, name: '8-C', studentCount: 30, covering: false },
      ]);

      await expect(svc.remove(SCHOOL, ASSIGNMENT_ID, CALLER, 'TEACHER')).resolves.toEqual({ ok: true });
    });
  });

  describe('upload', () => {
    const file = { originalname: 'worksheet.pdf', buffer: Buffer.from('x'), mimetype: 'application/pdf', size: 1024 };

    it('uploads a PDF via StorageService under schools/<id>/assignments and returns {url,name,kind}', async () => {
      storage.upload.mockResolvedValue({ key: 'k', url: 'https://x/worksheet.pdf' });

      const result = await svc.upload(SCHOOL, file);

      expect(storage.upload).toHaveBeenCalledWith(
        `schools/${SCHOOL}/assignments`,
        'worksheet.pdf',
        file.buffer,
        'application/pdf',
      );
      expect(result).toEqual({ url: 'https://x/worksheet.pdf', name: 'worksheet.pdf', kind: 'pdf' });
    });

    it('uploads an image and returns kind: "image"', async () => {
      storage.upload.mockResolvedValue({ key: 'k', url: 'https://x/photo.jpg' });

      const result = await svc.upload(SCHOOL, { ...file, originalname: 'photo.jpg', mimetype: 'image/jpeg' });

      expect(result.kind).toBe('image');
    });

    it('rejects a file over MAX_ATTACHMENT_BYTES with VALIDATION, without ever calling StorageService', async () => {
      await expect(
        svc.upload(SCHOOL, { ...file, size: MAX_ATTACHMENT_BYTES + 1 }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('rejects a disallowed mimetype (e.g. video) with VALIDATION, without ever calling StorageService', async () => {
      await expect(
        svc.upload(SCHOOL, { ...file, originalname: 'clip.mp4', mimetype: 'video/mp4' }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(storage.upload).not.toHaveBeenCalled();
    });
  });

  // Any TEACHER who learned another class's UUID could otherwise post an
  // assignment for it (which queues a push to that class's students), list
  // its assignments, or delete one from it. Mirrors the ownership rule
  // `ExamsService`/`AnnouncementsService` already enforce.
  describe('TEACHER class ownership', () => {
    const dto: CreateAssignmentDto = {
      classSectionId: CLASS_SECTION,
      subjectId: SUBJECT,
      title: 'Worksheet 3',
      instructions: 'Complete questions 1-10.',
      dueDate: '2026-08-05',
    };
    const ownedSection = { classSectionId: CLASS_SECTION, name: '8-C', studentCount: 30, covering: false };
    const coveringOnlySection = { classSectionId: CLASS_SECTION, name: '8-C', studentCount: 30, covering: true };

    describe('create', () => {
      it('rejects a TEACHER targeting a class section they do not own — no assignment created, no outbox row', async () => {
        attendance.myClassSections.mockResolvedValue([]); // owns nothing

        await expect(svc.create(SCHOOL, CALLER, 'TEACHER', dto)).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });

        expect(txMock.assignment.create).not.toHaveBeenCalled();
        expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
      });

      it('succeeds for a TEACHER targeting a class section they own', async () => {
        attendance.myClassSections.mockResolvedValue([ownedSection]);
        txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION, name: '8-C' });
        txMock.assignment.create.mockResolvedValue({
          id: ASSIGNMENT_ID,
          ...dto,
          dueDate: new Date(dto.dueDate),
          attachments: [],
          createdByTeacherId: CALLER,
          createdAt: new Date('2026-07-30T00:00:00.000Z'),
        });

        const result = await svc.create(SCHOOL, CALLER, 'TEACHER', dto);

        expect(result).toEqual(expect.objectContaining({ id: ASSIGNMENT_ID }));
        expect(txMock.assignment.create).toHaveBeenCalled();
      });

      it('rejects a TEACHER who only COVERS the class as a one-day substitute — covering a class once does not let you post an assignment for it', async () => {
        attendance.myClassSections.mockResolvedValue([coveringOnlySection]);

        await expect(svc.create(SCHOOL, CALLER, 'TEACHER', dto)).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.assignment.create).not.toHaveBeenCalled();
      });
    });

    describe('list', () => {
      it('rejects a TEACHER listing assignments for a class section they do not own', async () => {
        attendance.myClassSections.mockResolvedValue([]);

        await expect(svc.list(SCHOOL, CLASS_SECTION, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.assignment.findMany).not.toHaveBeenCalled();
      });

      it('rejects a TEACHER who only COVERS the class', async () => {
        attendance.myClassSections.mockResolvedValue([coveringOnlySection]);

        await expect(svc.list(SCHOOL, CLASS_SECTION, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.assignment.findMany).not.toHaveBeenCalled();
      });

      it('succeeds for a TEACHER listing assignments for a class section they own', async () => {
        attendance.myClassSections.mockResolvedValue([ownedSection]);
        txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
        txMock.assignment.findMany.mockResolvedValue([]);

        await expect(svc.list(SCHOOL, CLASS_SECTION, CALLER, 'TEACHER')).resolves.toEqual({
          upcoming: [],
          past: [],
        });
      });
    });

    describe('remove resolves ownership from the STORED assignment row', () => {
      it('rejects a TEACHER who does not own the assignment\'s stored class section — deletes nothing', async () => {
        txMock.assignment.findFirst.mockResolvedValue({ classSectionId: CLASS_SECTION });
        attendance.myClassSections.mockResolvedValue([]); // owns some OTHER class, not this one

        await expect(svc.remove(SCHOOL, ASSIGNMENT_ID, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.assignment.delete).not.toHaveBeenCalled();
      });

      it('succeeds for a TEACHER who owns the assignment\'s stored class section', async () => {
        txMock.assignment.findFirst.mockResolvedValue({ classSectionId: CLASS_SECTION });
        attendance.myClassSections.mockResolvedValue([ownedSection]);
        txMock.assignment.delete.mockResolvedValue({});

        await expect(svc.remove(SCHOOL, ASSIGNMENT_ID, CALLER, 'TEACHER')).resolves.toEqual({ ok: true });
      });

      it('a covering-only TEACHER cannot delete an assignment from the class they substituted in', async () => {
        txMock.assignment.findFirst.mockResolvedValue({ classSectionId: CLASS_SECTION });
        attendance.myClassSections.mockResolvedValue([coveringOnlySection]);

        await expect(svc.remove(SCHOOL, ASSIGNMENT_ID, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.assignment.delete).not.toHaveBeenCalled();
      });
    });

    describe('SCHOOL_ADMIN is unrestricted', () => {
      it('create: never consults myClassSections for a SCHOOL_ADMIN caller', async () => {
        txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION, name: '8-C' });
        txMock.assignment.create.mockResolvedValue({
          id: ASSIGNMENT_ID,
          ...dto,
          dueDate: new Date(dto.dueDate),
          attachments: [],
          createdByTeacherId: CALLER,
          createdAt: new Date('2026-07-30T00:00:00.000Z'),
        });

        await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);

        expect(attendance.myClassSections).not.toHaveBeenCalled();
      });

      it('remove: never consults myClassSections for a SCHOOL_ADMIN caller, even on an unowned-looking class', async () => {
        txMock.assignment.findFirst.mockResolvedValue({ classSectionId: OTHER_SECTION });
        txMock.assignment.delete.mockResolvedValue({});

        await expect(svc.remove(SCHOOL, ASSIGNMENT_ID, CALLER, 'SCHOOL_ADMIN')).resolves.toEqual({ ok: true });
        expect(attendance.myClassSections).not.toHaveBeenCalled();
      });
    });
  });
});
