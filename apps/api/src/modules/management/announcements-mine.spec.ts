const txMock = {
  classSection: { findMany: jest.fn(), findFirst: jest.fn() },
  announcement: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { NotFoundException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AttendanceService } from './attendance.service';
import type { UpdateAnnouncementDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER_A = 'teacher-a';
const TEACHER_B = 'teacher-b';
const ADMIN = 'admin-1';
const ANN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function announcementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ANN_ID,
    schoolId: SCHOOL,
    title: 'Original title',
    body: 'Original body',
    classSectionId: null,
    createdByUserId: TEACHER_A,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AnnouncementsService — mine / authorship-scoped edit+delete', () => {
  const notifications = { notify: jest.fn() };
  const attendance = { myClassSections: jest.fn() };
  const svc = new AnnouncementsService(
    notifications as unknown as NotificationService,
    attendance as unknown as AttendanceService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
  });

  describe('mine()', () => {
    it('returns only the caller-authored rows, newest first, with resolved class names', async () => {
      txMock.announcement.findMany.mockResolvedValue([
        {
          id: 'ann-2',
          title: 'Second',
          body: 'body-2',
          classSectionId: 'sec-1',
          createdAt: new Date('2026-07-02T00:00:00Z'),
          classSection: { name: 'A', grade: { name: '5' } },
        },
        {
          id: 'ann-1',
          title: 'First (whole school)',
          body: 'body-1',
          classSectionId: null,
          createdAt: new Date('2026-07-01T00:00:00Z'),
          classSection: null,
        },
      ]);

      const rows = await svc.mine(SCHOOL, TEACHER_A);

      expect(txMock.announcement.findMany).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, createdByUserId: TEACHER_A },
        orderBy: { createdAt: 'desc' },
        include: { classSection: { select: { name: true, grade: { select: { name: true } } } } },
      });
      expect(rows).toEqual([
        {
          id: 'ann-2',
          title: 'Second',
          body: 'body-2',
          classSectionId: 'sec-1',
          className: '5-A',
          createdAt: '2026-07-02T00:00:00.000Z',
        },
        {
          id: 'ann-1',
          title: 'First (whole school)',
          body: 'body-1',
          classSectionId: null,
          className: null,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ]);
    });

    it('scopes the DB query to createdByUserId — never returns another author’s rows', async () => {
      txMock.announcement.findMany.mockResolvedValue([]);
      await svc.mine(SCHOOL, TEACHER_B);
      expect(txMock.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { schoolId: SCHOOL, createdByUserId: TEACHER_B } }),
      );
    });
  });

  describe('update() — authorship enforcement', () => {
    it('a TEACHER editing their OWN row succeeds (title/body only)', async () => {
      txMock.announcement.findFirst.mockResolvedValue(announcementRow({ createdByUserId: TEACHER_A }));
      txMock.announcement.update.mockResolvedValue(announcementRow({ title: 'Fixed typo' }));

      const dto: UpdateAnnouncementDto = { title: 'Fixed typo' };
      const result = await svc.update(SCHOOL, ANN_ID, dto, { userId: TEACHER_A, role: 'TEACHER' });

      expect(txMock.announcement.update).toHaveBeenCalledWith({
        where: { id: ANN_ID },
        data: { title: 'Fixed typo' },
      });
      expect(result).toMatchObject({ title: 'Fixed typo' });
    });

    // Deletion-proof: this is the test that fails if the authorship check in
    // AnnouncementsService.update is removed — it exists specifically to
    // catch that regression, not just to exercise the happy path.
    it('a TEACHER editing ANOTHER teacher’s row is rejected with 403 ANNOUNCEMENT_NOT_OWNED', async () => {
      txMock.announcement.findFirst.mockResolvedValue(announcementRow({ createdByUserId: TEACHER_A }));

      const dto: UpdateAnnouncementDto = { title: 'Hijacked' };

      await expect(
        svc.update(SCHOOL, ANN_ID, dto, { userId: TEACHER_B, role: 'TEACHER' }),
      ).rejects.toMatchObject({ response: { code: 'ANNOUNCEMENT_NOT_OWNED' }, status: 403 });
      expect(txMock.announcement.update).not.toHaveBeenCalled();
    });

    it('a TEACHER may not retarget classSectionId — even on their own row (targets are immutable in v1)', async () => {
      txMock.announcement.findFirst.mockResolvedValue(announcementRow({ createdByUserId: TEACHER_A }));

      const dto: UpdateAnnouncementDto = { classSectionId: 'sec-new' };

      await expect(
        svc.update(SCHOOL, ANN_ID, dto, { userId: TEACHER_A, role: 'TEACHER' }),
      ).rejects.toMatchObject({ response: { code: 'ANNOUNCEMENT_TARGETS_LOCKED' }, status: 400 });
      expect(txMock.announcement.update).not.toHaveBeenCalled();
    });

    it('SCHOOL_ADMIN may edit any row, including retargeting classSectionId (unchanged behaviour)', async () => {
      txMock.announcement.findFirst.mockResolvedValue(announcementRow({ createdByUserId: TEACHER_A }));
      txMock.classSection.findFirst.mockResolvedValue({ id: 'sec-new' });
      txMock.announcement.update.mockResolvedValue(announcementRow({ classSectionId: 'sec-new' }));

      const dto: UpdateAnnouncementDto = { classSectionId: 'sec-new' };
      await svc.update(SCHOOL, ANN_ID, dto, { userId: ADMIN, role: 'SCHOOL_ADMIN' });

      expect(txMock.announcement.update).toHaveBeenCalledWith({
        where: { id: ANN_ID },
        data: { classSectionId: 'sec-new' },
      });
    });

    it('404s when the row does not exist, for either role', async () => {
      txMock.announcement.findFirst.mockResolvedValue(null);

      await expect(
        svc.update(SCHOOL, ANN_ID, { title: 'x' }, { userId: TEACHER_A, role: 'TEACHER' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove() — authorship enforcement', () => {
    it('a TEACHER deleting their OWN row succeeds', async () => {
      txMock.announcement.findFirst.mockResolvedValue(announcementRow({ createdByUserId: TEACHER_A }));
      txMock.announcement.delete.mockResolvedValue(announcementRow());

      const result = await svc.remove(SCHOOL, ANN_ID, { userId: TEACHER_A, role: 'TEACHER' });

      expect(txMock.announcement.delete).toHaveBeenCalledWith({ where: { id: ANN_ID } });
      expect(result).toEqual({ ok: true });
    });

    // Deletion-proof, mirroring the update() case above — this is the test
    // that fails if the authorship check in AnnouncementsService.remove is
    // removed.
    it('a TEACHER deleting ANOTHER teacher’s row is rejected with 403 ANNOUNCEMENT_NOT_OWNED', async () => {
      txMock.announcement.findFirst.mockResolvedValue(announcementRow({ createdByUserId: TEACHER_A }));

      await expect(
        svc.remove(SCHOOL, ANN_ID, { userId: TEACHER_B, role: 'TEACHER' }),
      ).rejects.toMatchObject({ response: { code: 'ANNOUNCEMENT_NOT_OWNED' }, status: 403 });
      expect(txMock.announcement.delete).not.toHaveBeenCalled();
    });

    it('SCHOOL_ADMIN may delete any row regardless of author (unchanged behaviour)', async () => {
      txMock.announcement.findFirst.mockResolvedValue(announcementRow({ createdByUserId: TEACHER_A }));
      txMock.announcement.delete.mockResolvedValue(announcementRow());

      const result = await svc.remove(SCHOOL, ANN_ID, { userId: ADMIN, role: 'SCHOOL_ADMIN' });

      expect(txMock.announcement.delete).toHaveBeenCalledWith({ where: { id: ANN_ID } });
      expect(result).toEqual({ ok: true });
    });

    it('404s when the row does not exist', async () => {
      txMock.announcement.findFirst.mockResolvedValue(null);

      await expect(
        svc.remove(SCHOOL, ANN_ID, { userId: TEACHER_A, role: 'TEACHER' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
