const txMock = {
  classSection: { findMany: jest.fn() },
  announcement: { create: jest.fn() },
  school: { findFirst: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { BadRequestException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AttendanceService, MyClassSection } from './attendance.service';
import type { CreateAnnouncementDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_A = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLASS_B = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLASS_FOREIGN = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TEACHER_USER = 'user-teacher-1';
const ADMIN_USER = 'user-admin-1';

/** Let the post-response (fire-and-forget) notification work run to completion. */
const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));

function classSectionRow(id: string, name: string, gradeName: string) {
  return { id, name, grade: { name: gradeName } };
}

describe('AnnouncementsService — teacher multi-class create + push fan-out', () => {
  const notifications = { notify: jest.fn() };
  const attendance = { myClassSections: jest.fn() };
  const svc = new AnnouncementsService(
    notifications as unknown as NotificationService,
    attendance as unknown as AttendanceService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    notifications.notify.mockResolvedValue({ sent: 0, failed: 0 });
    txMock.school.findFirst.mockResolvedValue({ name: 'Green Valley School' });
    // Reset every test's DB state explicitly (not just call-count clearing) —
    // `jest.clearAllMocks()` does NOT remove a `mockResolvedValue` set by a
    // prior test, so a test that forgets to set `classSection.findMany`
    // would otherwise silently inherit the previous test's rows.
    txMock.classSection.findMany.mockResolvedValue([]);
    txMock.student.findMany.mockResolvedValue([]);
    txMock.user.findMany.mockResolvedValue([]);
    txMock.announcement.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `ann-${data.classSectionId ?? 'school'}`, ...data }),
    );
  });

  it('creates one announcement row per targeted class section', async () => {
    attendance.myClassSections.mockResolvedValue([
      { classSectionId: CLASS_A, name: '5-A', studentCount: 2 },
      { classSectionId: CLASS_B, name: '5-B', studentCount: 3 },
    ] satisfies MyClassSection[]);
    txMock.classSection.findMany.mockResolvedValue([
      classSectionRow(CLASS_A, 'A', '5'),
      classSectionRow(CLASS_B, 'B', '5'),
    ]);

    const dto: CreateAnnouncementDto = {
      title: 'PTM this Friday',
      body: 'Please attend.',
      classSectionIds: [CLASS_A, CLASS_B],
    };

    const rows = await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);

    expect(txMock.announcement.create).toHaveBeenCalledTimes(2);
    expect(txMock.announcement.create).toHaveBeenNthCalledWith(1, {
      data: {
        schoolId: SCHOOL,
        title: 'PTM this Friday',
        body: 'Please attend.',
        classSectionId: CLASS_A,
        createdByUserId: TEACHER_USER,
      },
    });
    expect(txMock.announcement.create).toHaveBeenNthCalledWith(2, {
      data: {
        schoolId: SCHOOL,
        title: 'PTM this Friday',
        body: 'Please attend.',
        classSectionId: CLASS_B,
        createdByUserId: TEACHER_USER,
      },
    });
    expect(rows).toHaveLength(2);
    await flushBackgroundWork();
  });

  it('403s when a teacher targets a class that is not theirs', async () => {
    attendance.myClassSections.mockResolvedValue([
      { classSectionId: CLASS_A, name: '5-A', studentCount: 2 },
    ] satisfies MyClassSection[]);

    const dto: CreateAnnouncementDto = {
      title: 'Not yours',
      body: 'Should be rejected.',
      classSectionIds: [CLASS_A, CLASS_FOREIGN],
    };

    await expect(svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto)).rejects.toMatchObject({
      response: { code: 'CLASS_NOT_OWNED' },
    });
    expect(txMock.announcement.create).not.toHaveBeenCalled();
  });

  it('403s when a teacher omits classSectionIds (no implicit whole-school for teachers)', async () => {
    const dto: CreateAnnouncementDto = { title: 'Whole school?', body: 'Nope.' };

    await expect(svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto)).rejects.toMatchObject({
      response: { code: 'CLASS_NOT_OWNED' },
    });
    expect(attendance.myClassSections).not.toHaveBeenCalled();
    expect(txMock.announcement.create).not.toHaveBeenCalled();
  });

  it('SCHOOL_ADMIN may create a whole-school announcement (classSectionId null)', async () => {
    const dto: CreateAnnouncementDto = {
      title: 'School closed Monday',
      body: 'Public holiday.',
    };

    const rows = await svc.create(SCHOOL, ADMIN_USER, 'SCHOOL_ADMIN', dto);

    expect(attendance.myClassSections).not.toHaveBeenCalled();
    expect(txMock.announcement.create).toHaveBeenCalledTimes(1);
    expect(txMock.announcement.create).toHaveBeenCalledWith({
      data: {
        schoolId: SCHOOL,
        title: 'School closed Monday',
        body: 'Public holiday.',
        classSectionId: null,
        createdByUserId: ADMIN_USER,
      },
    });
    expect(rows).toHaveLength(1);
  });

  it('SCHOOL_ADMIN is not restricted to owned classes', async () => {
    txMock.classSection.findMany.mockResolvedValue([classSectionRow(CLASS_FOREIGN, 'Z', '9')]);

    const dto: CreateAnnouncementDto = {
      title: 'Any class',
      body: 'Admin can target any class.',
      classSectionIds: [CLASS_FOREIGN],
    };

    const rows = await svc.create(SCHOOL, ADMIN_USER, 'SCHOOL_ADMIN', dto);

    expect(attendance.myClassSections).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    await flushBackgroundWork();
  });

  it('rejects a classSectionId that does not resolve to a real class section', async () => {
    attendance.myClassSections.mockResolvedValue([
      { classSectionId: CLASS_A, name: '5-A', studentCount: 2 },
    ] satisfies MyClassSection[]);
    // classSection lookup comes back short — CLASS_A does not actually exist.
    txMock.classSection.findMany.mockResolvedValue([]);

    const dto: CreateAnnouncementDto = { title: 'x', body: 'y', classSectionIds: [CLASS_A] };

    await expect(svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(txMock.announcement.create).not.toHaveBeenCalled();
  });

  describe('legacy classSectionId + classSectionIds merge (ownership must hold across both)', () => {
    it('accepts an owned class via the legacy singular classSectionId field', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 2 },
      ] satisfies MyClassSection[]);
      txMock.classSection.findMany.mockResolvedValue([classSectionRow(CLASS_A, 'A', '5')]);

      const dto: CreateAnnouncementDto = { title: 'x', body: 'y', classSectionId: CLASS_A };

      const rows = await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);

      expect(rows).toHaveLength(1);
      expect(txMock.announcement.create).toHaveBeenCalledWith({
        data: {
          schoolId: SCHOOL,
          title: 'x',
          body: 'y',
          classSectionId: CLASS_A,
          createdByUserId: TEACHER_USER,
        },
      });
      await flushBackgroundWork();
    });

    it('403s when a teacher targets a NON-owned class via the legacy singular classSectionId field (no ownership bypass)', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 2 },
      ] satisfies MyClassSection[]);

      const dto: CreateAnnouncementDto = { title: 'x', body: 'y', classSectionId: CLASS_FOREIGN };

      await expect(svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto)).rejects.toMatchObject({
        response: { code: 'CLASS_NOT_OWNED' },
      });
      expect(txMock.announcement.create).not.toHaveBeenCalled();
    });

    it('merges and dedupes classSectionId + classSectionIds into a single target set', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 2 },
        { classSectionId: CLASS_B, name: '5-B', studentCount: 3 },
      ] satisfies MyClassSection[]);
      txMock.classSection.findMany.mockResolvedValue([
        classSectionRow(CLASS_A, 'A', '5'),
        classSectionRow(CLASS_B, 'B', '5'),
      ]);

      // CLASS_A appears in BOTH fields — must be de-duped to a single row,
      // not created twice.
      const dto: CreateAnnouncementDto = {
        title: 'x',
        body: 'y',
        classSectionId: CLASS_A,
        classSectionIds: [CLASS_A, CLASS_B],
      };

      const rows = await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);

      expect(txMock.announcement.create).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(2);
      await flushBackgroundWork();
    });

    it('rejects a merged target set (classSectionId + classSectionIds) exceeding 30 class sections', async () => {
      const thirty = Array.from(
        { length: 30 },
        (_, i) => `cccccccc-cccc-cccc-cccc-${String(i).padStart(12, '0')}`,
      );
      const dto: CreateAnnouncementDto = {
        title: 'x',
        body: 'y',
        classSectionId: CLASS_FOREIGN, // distinct 31st id after merge
        classSectionIds: thirty,
      };

      await expect(svc.create(SCHOOL, ADMIN_USER, 'SCHOOL_ADMIN', dto)).rejects.toThrow(
        BadRequestException,
      );
      // Rejected by the merged-set cap itself, BEFORE any DB round-trip —
      // not incidentally by the "sections not found" check further down.
      expect(txMock.classSection.findMany).not.toHaveBeenCalled();
      expect(txMock.announcement.create).not.toHaveBeenCalled();
    });
  });

  describe('push/email fan-out', () => {
    it('enqueues ANNOUNCEMENT notifications for recipients of targeted classes', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 1 },
      ] satisfies MyClassSection[]);
      txMock.classSection.findMany.mockResolvedValue([classSectionRow(CLASS_A, 'A', '5')]);
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      const dto: CreateAnnouncementDto = {
        title: 'PTM this Friday',
        body: 'Please attend.',
        classSectionIds: [CLASS_A],
      };

      await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);
      await flushBackgroundWork();

      expect(notifications.notify).toHaveBeenCalledWith('ANNOUNCEMENT', [
        {
          email: 'parent@x.com',
          payload: {
            schoolName: 'Green Valley School',
            title: 'PTM this Friday',
            body: 'Please attend.',
            className: '5-A',
          },
        },
      ]);
    });

    it('gives each targeted class its own className in the payload', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 1 },
        { classSectionId: CLASS_B, name: '5-B', studentCount: 1 },
      ] satisfies MyClassSection[]);
      txMock.classSection.findMany.mockResolvedValue([
        classSectionRow(CLASS_A, 'A', '5'),
        classSectionRow(CLASS_B, 'B', '5'),
      ]);
      txMock.student.findMany
        .mockResolvedValueOnce([{ userId: 'u-1' }])
        .mockResolvedValueOnce([{ userId: 'u-2' }]);
      txMock.user.findMany.mockResolvedValue([
        { id: 'u-1', email: 'a@x.com' },
        { id: 'u-2', email: 'b@x.com' },
      ]);

      const dto: CreateAnnouncementDto = {
        title: 'Sports day',
        body: 'Bring water bottles.',
        classSectionIds: [CLASS_A, CLASS_B],
      };

      await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);
      await flushBackgroundWork();

      expect(notifications.notify).toHaveBeenCalledWith('ANNOUNCEMENT', [
        expect.objectContaining({ email: 'a@x.com', payload: expect.objectContaining({ className: '5-A' }) }),
        expect.objectContaining({ email: 'b@x.com', payload: expect.objectContaining({ className: '5-B' }) }),
      ]);
    });

    it('does not call the notification service when the targeted classes have no linked-user recipients', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 1 },
      ] satisfies MyClassSection[]);
      txMock.classSection.findMany.mockResolvedValue([classSectionRow(CLASS_A, 'A', '5')]);
      txMock.student.findMany.mockResolvedValue([]); // nobody linked to a portal account

      const dto: CreateAnnouncementDto = { title: 'x', body: 'y', classSectionIds: [CLASS_A] };

      await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);
      await flushBackgroundWork();

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('a whole-school announcement fans out ANNOUNCEMENT to every linked-user student in the school (className null)', async () => {
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }]);
      txMock.user.findMany.mockResolvedValue([
        { id: 'u-1', email: 'a@x.com' },
        { id: 'u-2', email: 'b@x.com' },
      ]);

      const dto: CreateAnnouncementDto = { title: 'School closed Monday', body: 'Public holiday.' };

      await svc.create(SCHOOL, ADMIN_USER, 'SCHOOL_ADMIN', dto);
      await flushBackgroundWork();

      // Whole-school recipient resolution has no classSectionId filter —
      // the school-wide counterpart to resolveSectionRecipients.
      expect(txMock.student.findMany).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, userId: { not: null } },
        select: { userId: true },
      });
      expect(notifications.notify).toHaveBeenCalledWith('ANNOUNCEMENT', [
        {
          email: 'a@x.com',
          payload: {
            schoolName: 'Green Valley School',
            title: 'School closed Monday',
            body: 'Public holiday.',
            className: null,
          },
        },
        {
          email: 'b@x.com',
          payload: {
            schoolName: 'Green Valley School',
            title: 'School closed Monday',
            body: 'Public holiday.',
            className: null,
          },
        },
      ]);
    });

    it('does not call the notification service for a whole-school announcement when nobody in the school has a linked user account', async () => {
      txMock.student.findMany.mockResolvedValue([]);

      const dto: CreateAnnouncementDto = { title: 'Whole school', body: 'body' };

      await svc.create(SCHOOL, ADMIN_USER, 'SCHOOL_ADMIN', dto);
      await flushBackgroundWork();

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('a single-class announcement only notifies that class, never the whole school', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 1 },
      ] satisfies MyClassSection[]);
      txMock.classSection.findMany.mockResolvedValue([classSectionRow(CLASS_A, 'A', '5')]);
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      const dto: CreateAnnouncementDto = { title: 'x', body: 'y', classSectionIds: [CLASS_A] };

      await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);
      await flushBackgroundWork();

      // The school-wide query shape (no classSectionId) must never be used
      // for a class-targeted announcement.
      expect(txMock.student.findMany).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, classSectionId: CLASS_A, userId: { not: null } },
        select: { userId: true },
      });
      expect(notifications.notify).toHaveBeenCalledWith('ANNOUNCEMENT', [
        expect.objectContaining({ email: 'parent@x.com', payload: expect.objectContaining({ className: '5-A' }) }),
      ]);
    });

    it('resolves recipients in a SEPARATE transaction, after the write has committed', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 1 },
      ] satisfies MyClassSection[]);
      txMock.classSection.findMany.mockResolvedValue([classSectionRow(CLASS_A, 'A', '5')]);
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      const dto: CreateAnnouncementDto = { title: 'x', body: 'y', classSectionIds: [CLASS_A] };

      await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);
      await flushBackgroundWork();

      expect(withTenantMock).toHaveBeenCalledTimes(2);
    });

    it('still creates the announcement rows when the background notify rejects', async () => {
      attendance.myClassSections.mockResolvedValue([
        { classSectionId: CLASS_A, name: '5-A', studentCount: 1 },
      ] satisfies MyClassSection[]);
      txMock.classSection.findMany.mockResolvedValue([classSectionRow(CLASS_A, 'A', '5')]);
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
      notifications.notify.mockRejectedValue(new Error('smtp down'));

      const dto: CreateAnnouncementDto = { title: 'x', body: 'y', classSectionIds: [CLASS_A] };

      const rows = await svc.create(SCHOOL, TEACHER_USER, 'TEACHER', dto);
      await flushBackgroundWork();

      expect(rows).toHaveLength(1);
    });
  });
});
