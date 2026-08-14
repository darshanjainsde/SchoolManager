const mockLibraryOrg = { findUnique: jest.fn() };
const mockMember = { count: jest.fn() };
const mockCopy = { count: jest.fn() };

jest.mock('@library/db', () => ({
  getLibraryPlatformPrisma: () => ({
    libraryOrg: mockLibraryOrg,
    member: mockMember,
    copy: mockCopy,
  }),
}));

// Redis is a cache in front of the org lookup. Every method here answers as an
// empty cache so the tests exercise the DATABASE path, which is the one whose
// failure modes matter.
const mockRedis = {
  status: 'ready',
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  connect: jest.fn(),
};
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => mockRedis) }));

import { LibraryOrgService } from './library-org.service';

/**
 * `isLiveForSchool` runs on EVERY `/auth/me`.
 *
 * That is the whole reason this file exists. `/auth/me` is the first call every
 * portal in the product makes on load — student, teacher, admin, mobile — so a
 * library database that is unreachable, unconfigured, or simply absent must
 * degrade to "no library tab" and never to a failed login. Before this, nothing
 * in `apps/api` asserted that: the module had no tests at all.
 */
describe('LibraryOrgService.isLiveForSchool — must never break a login', () => {
  let service: LibraryOrgService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    service = new LibraryOrgService();
  });

  it('is false, not an exception, when the library database is unreachable', async () => {
    mockLibraryOrg.findUnique.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(service.isLiveForSchool('school-1')).resolves.toBe(false);
  });

  it('is false when this deployment has no library database configured at all', async () => {
    // The real shape of that failure: `@library/db` throws about the missing
    // env var. A school that never bought the library must still be able to
    // sign in on a deployment where those URLs were never set.
    mockLibraryOrg.findUnique.mockRejectedValue(
      new Error('LIBRARY_DATABASE_URL_APP must be set'),
    );
    await expect(service.isLiveForSchool('school-1')).resolves.toBe(false);
  });

  it('is false for a school with no library provisioned', async () => {
    mockLibraryOrg.findUnique.mockResolvedValue(null);
    await expect(service.isLiveForSchool('school-1')).resolves.toBe(false);
  });

  it('is false for a library still in SETUP or SUSPENDED, without asking about books', async () => {
    // A suspended org resolves to no id at all, so the counts are never
    // reached — the caller's only question is "can this school use its library
    // right now", and answering with an id would push that check out to every
    // call site until one forgot it.
    mockLibraryOrg.findUnique.mockResolvedValue({ id: 'org-1', status: 'SUSPENDED' });
    await expect(service.isLiveForSchool('school-1')).resolves.toBe(false);
    expect(mockCopy.count).not.toHaveBeenCalled();
  });

  it('is false for a provisioned library with an empty shelf', async () => {
    // This is the second of the two gates on the student and teacher menu item.
    // A tab that opens onto an empty shelf during the weeks between setup and
    // stocking is the impression every child forms of the feature.
    mockLibraryOrg.findUnique.mockResolvedValue({ id: 'org-1', status: 'LIVE' });
    mockMember.count.mockResolvedValue(412);
    mockCopy.count.mockResolvedValue(0);
    await expect(service.isLiveForSchool('school-1')).resolves.toBe(false);
  });

  it('is true only once there is a book in it', async () => {
    mockLibraryOrg.findUnique.mockResolvedValue({ id: 'org-1', status: 'LIVE' });
    mockMember.count.mockResolvedValue(412);
    mockCopy.count.mockResolvedValue(161);
    await expect(service.isLiveForSchool('school-1')).resolves.toBe(true);
  });
});

describe('LibraryOrgService.orgIdForSchool', () => {
  let service: LibraryOrgService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    service = new LibraryOrgService();
  });

  it('THROWS when the database is unreachable, unlike isLiveForSchool', async () => {
    // The asymmetry is deliberate and worth pinning. A counter route that
    // cannot reach the library must fail loudly — silently answering "no
    // library" would tell a librarian her school has none. Only the
    // /auth/me path swallows it, because there a failure would block a login.
    mockLibraryOrg.findUnique.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(service.orgIdForSchool('school-1')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('returns null — never an id — for a suspended org', async () => {
    mockLibraryOrg.findUnique.mockResolvedValue({ id: 'org-1', status: 'SUSPENDED' });
    await expect(service.orgIdForSchool('school-1')).resolves.toBeNull();
  });

  it('caches the ANSWER "no library", so a school without one stops hitting the database', async () => {
    mockLibraryOrg.findUnique.mockResolvedValue(null);
    await service.orgIdForSchool('school-1');
    // 'none' rather than an empty value: an unset cache entry and a cached
    // "there is nothing here" are different states, and conflating them is how
    // a negative lookup ends up uncached forever.
    expect(mockRedis.set).toHaveBeenCalledWith(expect.any(String), 'none', 'EX', expect.any(Number));
  });
});
