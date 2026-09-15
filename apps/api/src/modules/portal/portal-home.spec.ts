const txMock = {
  student: { findFirst: jest.fn() },
  attendance: { findMany: jest.fn(), aggregate: jest.fn() },
  exam: { findMany: jest.fn() },
  result: { findMany: jest.fn(), groupBy: jest.fn() },
  subject: { findMany: jest.fn() },
  mediaAsset: { findFirst: jest.fn() },
  announcement: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
  getPlatformPrisma: () => ({ pushToken: { update: jest.fn() } }),
}));
jest.mock('../tenancy', () => ({
  TenantContextService: class TenantContextService {},
  TenancyModule: class TenancyModule {},
  SchoolLookupService: class SchoolLookupService {},
}));

import { PortalService } from './portal.service';
import type { TenantContextService } from '../tenancy';
import type { TimetableService, HolidaysService, DiaryService } from '../management';
import type { RegistrationsService } from '../community';

/**
 * GET /me/home answers the portal's seven questions at once.
 *
 * It is the highest-traffic screen in the product — every family, every day —
 * and it used to open with seven parallel requests. Each read resolved the
 * student in one tenant transaction and fetched its data in another, so one
 * page view cost about fourteen. A transaction holds a pooled connection for
 * its whole life, and concurrent connections are throughput times hold time,
 * so that count is what decides how many schools the platform carries.
 *
 * Two things have to be true for the change to be worth anything:
 *
 *   1. the composed answer is IDENTICAL to calling the seven routes — it had
 *      better be, since it calls those same methods;
 *   2. it actually costs fewer transactions. Asserting only the first would
 *      pass a version that changed nothing.
 */
const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STUDENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLASS_SECTION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('GET /me/home', () => {
  const tenant = { requireTenant: jest.fn() };
  const timetable = { listForClass: jest.fn() };
  const holidaysSvc = { list: jest.fn() };
  const diarySvc = { studentDiary: jest.fn(), sign: jest.fn() };
  const registrations = { register: jest.fn() };
  const svc = new PortalService(
    tenant as unknown as TenantContextService,
    timetable as unknown as TimetableService,
    holidaysSvc as unknown as HolidaysService,
    diarySvc as unknown as DiaryService,
    registrations as unknown as RegistrationsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    tenant.requireTenant.mockReturnValue({
      kind: 'tenant', schoolId: SCHOOL, hostname: 'green.sckools.com', schoolSlug: 'green',
    });
    txMock.student.findFirst.mockResolvedValue({
      id: STUDENT, userId: USER, firstName: 'Aarav', lastName: 'Sharma',
      admissionNo: 'SUN-2231', code: null, rollNo: '12', photoAssetId: null,
      classSectionId: CLASS_SECTION,
      classSection: { id: CLASS_SECTION, name: 'A', grade: { name: 'Class 8' } },
      createdAt: day('2026-04-05'),
    });
    txMock.attendance.findMany.mockResolvedValue([
      { date: day('2026-11-02'), status: 'PRESENT' },
      { date: day('2026-11-03'), status: 'ABSENT' },
    ]);
    txMock.attendance.aggregate.mockResolvedValue({ _min: { date: null } });
    txMock.announcement.findMany.mockResolvedValue([
      { id: 'a1', title: 'Open Day', body: 'Saturday', classSectionId: null, createdAt: day('2026-10-30') },
    ]);
    txMock.exam.findMany.mockResolvedValue([]);
    txMock.result.findMany.mockResolvedValue([]);
    txMock.subject.findMany.mockResolvedValue([]);
    timetable.listForClass.mockResolvedValue([{ day: 1, period: 1, subject: 'Mathematics' }]);
    diarySvc.studentDiary.mockResolvedValue({ entries: [] });
  });

  it('returns exactly what the seven routes return', async () => {
    const separately = {
      profile: await svc.profile(USER),
      timetable: await svc.timetable(USER),
      announcements: await svc.announcements(USER),
      attendance: await svc.attendance(USER, '2026-11'),
      exams: await svc.exams(USER),
      results: await svc.results(USER),
      diary: await svc.diary(USER),
    };

    const together = await svc.home(USER, '2026-11');

    expect(together).toEqual(separately);
  });

  it('costs far fewer tenant transactions than the seven routes', async () => {
    await svc.profile(USER);
    await svc.timetable(USER);
    await svc.announcements(USER);
    await svc.attendance(USER, '2026-11');
    await svc.exams(USER);
    await svc.results(USER);
    await svc.diary(USER);
    const sevenRoutes = withTenantMock.mock.calls.length;

    withTenantMock.mockClear();
    await svc.home(USER, '2026-11');
    const oneRoute = withTenantMock.mock.calls.length;

    // Everything this service owns — including the student lookup the five
    // reads share, and the one timetable() would have made — collapses into a
    // single transaction. Diary and the timetable query itself are delegated to
    // services that own their own rules and open their own; reaching into those
    // to thread a transaction through would move the rules for a smaller gain.
    expect(oneRoute).toBeLessThan(sevenRoutes);
    expect(oneRoute).toBe(1);
    expect(sevenRoutes).toBeGreaterThanOrEqual(5);
  });

  it('still refuses a login with no student record', async () => {
    txMock.student.findFirst.mockResolvedValue(null);
    await expect(svc.home(USER)).rejects.toThrow('No student record for this login');
  });

  it('passes the month through, and defaults it the same way the route does', async () => {
    const withMonth = await svc.home(USER, '2026-11');
    expect(withMonth.attendance.month).toBe('2026-11');

    const defaulted = await svc.home(USER);
    expect(defaulted.attendance.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('a student with no class section still gets an answer', async () => {
    txMock.student.findFirst.mockResolvedValue({
      id: STUDENT, userId: USER, firstName: 'Aarav', lastName: 'Sharma',
      admissionNo: 'SUN-2231', code: null, rollNo: null, photoAssetId: null,
      classSectionId: null, classSection: null, createdAt: day('2026-04-05'),
    });
    const home = await svc.home(USER, '2026-11');
    expect(home.timetable).toEqual([]);
    expect(home.exams).toEqual([]);
    expect(home.profile.className).toBeNull();
  });
});
