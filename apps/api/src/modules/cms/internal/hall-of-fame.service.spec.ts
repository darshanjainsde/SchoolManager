const txMock = {
  hallOfFameGroup: { findMany: jest.fn(), deleteMany: jest.fn(), update: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
  hallOfFameEntry: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  hallOfFameSettings: { findUnique: jest.fn(), upsert: jest.fn() },
  academicYear: { findFirst: jest.fn() },
  course: { findMany: jest.fn() },
  grade: { findMany: jest.fn() },
  classSection: { findMany: jest.fn() },
  student: { findMany: jest.fn() },
  mediaAsset: { findMany: jest.fn() },
};
const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

// Keep the real `Prisma` export (isSchemaMissing relies on
// `instanceof Prisma.PrismaClientKnownRequestError`); only `withTenant` is stubbed.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@skoolos/db';
import { HallOfFameService } from './hall-of-fame.service';
import type { FeatureResolverService } from '../../features';

const SCHOOL = 'school-1';
const COURSE = '11111111-1111-4111-8111-111111111111';
const GRADE = '22222222-2222-4222-8222-222222222222';
const SECTION_A = '33333333-3333-4333-8333-333333333333';
const SECTION_B = '44444444-4444-4444-8444-444444444444';
const GROUP = '55555555-5555-4555-8555-555555555555';
const STUDENT = '66666666-6666-4666-8666-666666666666';
const ASSET = '77777777-7777-4777-8777-777777777777';

const features = { getFeatures: jest.fn() } as unknown as jest.Mocked<FeatureResolverService>;
const svc = new HallOfFameService(features);

function schemaMissing(code: 'P2021' | 'P2022') {
  return new Prisma.PrismaClientKnownRequestError('missing', { code, clientVersion: 'test' });
}

beforeEach(() => {
  jest.clearAllMocks();
  txMock.academicYear.findFirst.mockResolvedValue({ startDate: new Date('2026-04-01T00:00:00Z') });
  txMock.hallOfFameGroup.findMany.mockResolvedValue([]);
  txMock.hallOfFameEntry.findMany.mockResolvedValue([]);
  txMock.hallOfFameSettings.findUnique.mockResolvedValue(null);
  txMock.course.findMany.mockResolvedValue([]);
  txMock.grade.findMany.mockResolvedValue([]);
  txMock.classSection.findMany.mockResolvedValue([]);
  txMock.student.findMany.mockResolvedValue([]);
  txMock.mediaAsset.findMany.mockResolvedValue([]);
  (features.getFeatures as jest.Mock).mockResolvedValue(new Set(['PUBLIC_SITE', 'MANAGEMENT']));
});

describe('overview', () => {
  it('reports the years that have entries, newest first, and the current batch year', async () => {
    txMock.hallOfFameEntry.findMany.mockResolvedValue([
      { id: 'e1', groupId: GROUP, batchYear: 2024, rank: 1, name: 'A', achievement: null, photoAssetId: null, studentId: null },
      { id: 'e2', groupId: GROUP, batchYear: 2026, rank: 1, name: 'B', achievement: null, photoAssetId: null, studentId: null },
    ]);
    const o = await svc.overview(SCHOOL);
    expect(o.years).toEqual([2026, 2024]);
    expect(o.currentYear).toBe(2026);
    expect(o.settings).toEqual({ landingYear: null, pastBatches: 4 });
    expect(o.unavailable).toBe(false);
  });

  it('degrades to an empty, flagged overview while the migration has not run', async () => {
    txMock.hallOfFameGroup.findMany.mockRejectedValue(schemaMissing('P2021'));
    const o = await svc.overview(SCHOOL);
    expect(o.unavailable).toBe(true);
    expect(o.groups).toEqual([]);
    expect(o.currentYear).toBe(2026);
  });

  it('falls back to the calendar year when no academic year is current', async () => {
    txMock.academicYear.findFirst.mockResolvedValue(null);
    const o = await svc.overview(SCHOOL);
    expect(o.currentYear).toBe(new Date().getUTCFullYear());
  });
});

describe('setGroups', () => {
  it('refuses class groups without the Management module', async () => {
    (features.getFeatures as jest.Mock).mockResolvedValue(new Set(['PUBLIC_SITE']));
    await expect(svc.setGroups(SCHOOL, [{ kind: 'GRADES', gradeIds: [GRADE] }])).rejects.toBeInstanceOf(ForbiddenException);
    expect(txMock.hallOfFameGroup.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a course the school does not own, before touching any row', async () => {
    await expect(svc.setGroups(SCHOOL, [{ kind: 'COURSE', courseId: COURSE }])).rejects.toBeInstanceOf(BadRequestException);
    expect(txMock.hallOfFameGroup.deleteMany).not.toHaveBeenCalled();
  });

  it('needs a name for a custom group', async () => {
    await expect(svc.setGroups(SCHOOL, [{ kind: 'CUSTOM', label: '  ' }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('labels a course group after the course and a clubbed grade after the grade', async () => {
    txMock.course.findMany.mockResolvedValue([{ id: COURSE, name: 'Primary School' }]);
    txMock.grade.findMany.mockResolvedValue([{ id: GRADE, name: 'Class 3', order: 3 }]);
    await svc.setGroups(SCHOOL, [
      { kind: 'COURSE', courseId: COURSE },
      { kind: 'GRADES', gradeIds: [GRADE] },
    ]);
    expect(txMock.hallOfFameGroup.create).toHaveBeenCalledTimes(2);
    expect(txMock.hallOfFameGroup.create.mock.calls[0][0].data).toMatchObject({ kind: 'COURSE', label: 'Primary School', order: 0, courseId: COURSE, schoolId: SCHOOL });
    expect(txMock.hallOfFameGroup.create.mock.calls[1][0].data).toMatchObject({ kind: 'GRADES', label: 'Class 3', order: 1, gradeIds: [GRADE], sectionIds: [] });
  });

  it('labels an un-clubbed section as grade-section and derives its grade', async () => {
    txMock.classSection.findMany.mockResolvedValue([{ id: SECTION_B, name: 'B', gradeId: GRADE, grade: { name: 'Class 3' } }]);
    await svc.setGroups(SCHOOL, [{ kind: 'GRADES', sectionIds: [SECTION_B] }]);
    expect(txMock.hallOfFameGroup.create.mock.calls[0][0].data).toMatchObject({ label: 'Class 3-B', gradeIds: [GRADE], sectionIds: [SECTION_B] });
  });

  it('rejects a section the school does not own', async () => {
    await expect(svc.setGroups(SCHOOL, [{ kind: 'GRADES', sectionIds: [SECTION_A] }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps owned ids (updating them in place) and deletes the rest', async () => {
    txMock.hallOfFameGroup.findMany.mockResolvedValue([{ id: GROUP }, { id: 'other-owned' }]);
    await svc.setGroups(SCHOOL, [{ id: GROUP, kind: 'CUSTOM', label: 'House champions' }]);
    expect(txMock.hallOfFameGroup.deleteMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, id: { notIn: [GROUP] } } });
    expect(txMock.hallOfFameGroup.update).toHaveBeenCalledWith({ where: { id: GROUP }, data: expect.objectContaining({ label: 'House champions', order: 0 }) });
    expect(txMock.hallOfFameGroup.create).not.toHaveBeenCalled();
  });

  it('treats an id the school does not own as a new group, never as an update', async () => {
    await svc.setGroups(SCHOOL, [{ id: GROUP, kind: 'CUSTOM', label: 'Toppers' }]);
    expect(txMock.hallOfFameGroup.update).not.toHaveBeenCalled();
    expect(txMock.hallOfFameGroup.create).toHaveBeenCalledTimes(1);
    expect(txMock.hallOfFameGroup.deleteMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, id: { notIn: [] } } });
  });
});

describe('setPodium', () => {
  beforeEach(() => {
    txMock.hallOfFameGroup.findFirst.mockResolvedValue({ id: GROUP });
  });

  it('bounds the batch year to 1990 … current + 1', async () => {
    await expect(svc.setPodium(SCHOOL, GROUP, 1985, [])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setPodium(SCHOOL, GROUP, 2028, [])).rejects.toBeInstanceOf(BadRequestException);
    expect(txMock.hallOfFameEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses two entries for one place', async () => {
    await expect(
      svc.setPodium(SCHOOL, GROUP, 2026, [{ rank: 1, name: 'A' }, { rank: 1, name: 'B' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s a group the school does not own', async () => {
    txMock.hallOfFameGroup.findFirst.mockResolvedValue(null);
    await expect(svc.setPodium(SCHOOL, GROUP, 2026, [{ rank: 1, name: 'A' }])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fills the name and photo from the register when a student is picked', async () => {
    txMock.student.findMany.mockResolvedValue([{ id: STUDENT, firstName: 'Ved', lastName: 'Sharma', photoAssetId: ASSET }]);
    await svc.setPodium(SCHOOL, GROUP, 2026, [{ rank: 1, studentId: STUDENT, achievement: ' 99% ' }]);
    expect(txMock.hallOfFameEntry.deleteMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, groupId: GROUP, batchYear: 2026 } });
    expect(txMock.hallOfFameEntry.createMany).toHaveBeenCalledWith({
      data: [{ schoolId: SCHOOL, groupId: GROUP, batchYear: 2026, rank: 1, name: 'Ved Sharma', achievement: '99%', photoAssetId: ASSET, studentId: STUDENT }],
    });
  });

  it('rejects a student or a photo the school does not own', async () => {
    await expect(svc.setPodium(SCHOOL, GROUP, 2026, [{ rank: 1, studentId: STUDENT }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setPodium(SCHOOL, GROUP, 2026, [{ rank: 1, name: 'A', photoAssetId: ASSET }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('drops a nameless place instead of storing an empty name', async () => {
    await svc.setPodium(SCHOOL, GROUP, 2026, [{ rank: 1, name: 'A' }, { rank: 2, name: '   ' }]);
    expect(txMock.hallOfFameEntry.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ rank: 1, name: 'A', achievement: null, photoAssetId: null, studentId: null })],
    });
  });

  it('clears the podium when every place is empty', async () => {
    await svc.setPodium(SCHOOL, GROUP, 2026, []);
    expect(txMock.hallOfFameEntry.deleteMany).toHaveBeenCalled();
    expect(txMock.hallOfFameEntry.createMany).not.toHaveBeenCalled();
  });
});

describe('setSettings', () => {
  it('upserts only the fields that were sent', async () => {
    await svc.setSettings(SCHOOL, { pastBatches: 6 });
    expect(txMock.hallOfFameSettings.upsert).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL },
      create: { schoolId: SCHOOL, landingYear: null, pastBatches: 6 },
      update: { pastBatches: 6 },
    });
    await svc.setSettings(SCHOOL, { landingYear: null });
    expect(txMock.hallOfFameSettings.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { landingYear: null } }));
  });
});
