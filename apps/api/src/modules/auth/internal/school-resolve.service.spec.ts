import { SchoolResolveService } from './school-resolve.service';

// Spread the real module so re-exported Prisma enums survive the mock (see
// ledger: api-jest-db-mock-nukes-enums) — this spec's service doesn't import
// tenancy today, but the spread costs nothing and keeps it safe if it ever does.
const studentFindMany = jest.fn();
const userFindMany = jest.fn();
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => ({
    student: { findMany: studentFindMany },
    user: { findMany: userFindMany },
  }),
}));

describe('SchoolResolveService', () => {
  let service: SchoolResolveService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SchoolResolveService();
  });

  it('resolves a student code (case-insensitively) to its school host', async () => {
    studentFindMany.mockResolvedValue([{ school: { slug: 'raffles' } }]);
    const hosts = await service.resolve('raf-00042');

    // Codes are stored uppercase; the lookup must uppercase the input.
    expect(studentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: 'RAF-00042' }),
      }),
    );
    expect(userFindMany).not.toHaveBeenCalled();
    expect(hosts).toEqual(['raffles.localhost']);
  });

  it('resolves a FOUR-digit code too — prod carries seeded RPS-0021-style codes (2026-08-07 gate bug)', async () => {
    studentFindMany.mockResolvedValue([{ school: { slug: 'raffles' } }]);
    const hosts = await service.resolve('RPS-0021');

    expect(studentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: 'RPS-0021' }),
      }),
    );
    expect(hosts).toEqual(['raffles.localhost']);
  });

  it('resolves an email to its school host, excluding platform-owner accounts', async () => {
    userFindMany.mockResolvedValue([{ school: { slug: 'acme' } }]);
    const hosts = await service.resolve('Teacher@Acme.edu');

    const where = userFindMany.mock.calls[0][0].where;
    expect(where.email).toEqual({ equals: 'teacher@acme.edu', mode: 'insensitive' });
    expect(where.schoolId).toEqual({ not: null });
    expect(studentFindMany).not.toHaveBeenCalled();
    expect(hosts).toEqual(['acme.localhost']);
  });

  it('returns [] for an admission-number-shaped identifier without querying', async () => {
    // "1023" is a per-school serial — resolving it globally would match half
    // the platform, so the service must refuse the shape outright.
    const hosts = await service.resolve('1023');
    expect(hosts).toEqual([]);
    expect(studentFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('returns [] when nothing matches', async () => {
    studentFindMany.mockResolvedValue([]);
    await expect(service.resolve('ZZZ-99999')).resolves.toEqual([]);
  });

  it('dedupes hosts when one school matches twice', async () => {
    // Two user rows, same school (e.g. a re-invited teacher) → one host.
    userFindMany.mockResolvedValue([{ school: { slug: 'acme' } }, { school: { slug: 'acme' } }]);
    await expect(service.resolve('t@acme.edu')).resolves.toEqual(['acme.localhost']);
  });

  it('excludes suspended schools in both lookups', async () => {
    studentFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);
    await service.resolve('RAF-00042');
    await service.resolve('t@x.com');
    expect(studentFindMany.mock.calls[0][0].where.school).toEqual({ status: { not: 'SUSPENDED' } });
    expect(userFindMany.mock.calls[0][0].where.school).toEqual({ status: { not: 'SUSPENDED' } });
  });
});
