import type { PrismaClient } from '../generated/client';
import { auditRlsCoverage } from './rls-audit';
import { getLibraryPlatformPrisma, disconnectLibrary } from './index';
import { describeLive } from './test-live';

describeLive('RLS coverage audit', () => {
  afterAll(async () => { await disconnectLibrary(); });

  it('reports every orgId-bearing table as forced and policied', async () => {
    const result = await auditRlsCoverage(getLibraryPlatformPrisma());
    expect(result.unprotected).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('allow-lists exactly the three hash-keyed token tables', async () => {
    const result = await auditRlsCoverage(getLibraryPlatformPrisma());
    expect(result.allowListed.sort()).toEqual(
      ['PasswordResetToken', 'RefreshToken', 'RegistrationToken'].sort(),
    );
  });

  it('actually inspected at least one tenant table', async () => {
    // Guards against the audit passing vacuously against an empty or
    // mis-scoped database: unprotected:[] alone does not mean "healthy", it
    // can also mean "found nothing to check".
    const result = await auditRlsCoverage(getLibraryPlatformPrisma());
    expect(result.tablesChecked).toBeGreaterThan(0);
  });
});

// Not live-gated: this is a pure unit test of the guard logic against a
// mocked client, so it runs on a laptop with no database credentials and
// proves the vacuous-pass case can't recur.
describe('RLS coverage audit (unit)', () => {
  it('is not ok when zero tables were inspected, even though nothing is unprotected', async () => {
    const emptyClient = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const result = await auditRlsCoverage(emptyClient);

    expect(result.tablesChecked).toBe(0);
    expect(result.unprotected).toEqual([]);
    expect(result.ok).toBe(false);
  });
});
