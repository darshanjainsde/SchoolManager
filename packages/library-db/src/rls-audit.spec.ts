import { Client } from 'pg';
import type { PrismaClient } from '../generated/client';
import { auditRlsCoverage } from './rls-audit';
import { getLibraryPlatformPrisma, disconnectLibrary } from './index';
import { describeLive, LIVE } from './test-live';

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

// Requires a superuser connection (LIBRARY_DIRECT_URL, falling back to
// LIBRARY_DATABASE_URL) to CREATE/DROP a scratch table — neither library_app
// nor library_platform has CREATE on schema library (see
// scripts/library-db-init.sql), by design. Gated the same way test-live.ts
// gates everything else in this file: outside CI a missing superuser URL is
// a plain skip, inside CI it is a loud failure — this is the audit's own
// "no future table escapes tenancy" guarantee, so it must not silently not
// run.
const SUPERUSER_URL = process.env.LIBRARY_DIRECT_URL ?? process.env.LIBRARY_DATABASE_URL;
if (LIVE && !SUPERUSER_URL && process.env.CI) {
  throw new Error(
    'LIVE is true (LIBRARY_DATABASE_URL_PLATFORM is set) but neither LIBRARY_DIRECT_URL nor ' +
      'LIBRARY_DATABASE_URL is set while process.env.CI is set. The permissive-policy regression ' +
      'test in rls-audit.spec.ts needs a superuser connection to create/drop its scratch table and ' +
      'must not silently skip in CI.',
  );
}
const describeLiveSuperuser = LIVE && SUPERUSER_URL ? describe : describe.skip;

describeLiveSuperuser('RLS coverage audit — permissive-policy blind spot (Group B, finding 1)', () => {
  const TABLE = 'RlsAuditPermissiveTest';

  afterAll(async () => { await disconnectLibrary(); });

  it('rejects a table whose policy exists but does not scope by app.current_org (USING (true))', async () => {
    const client = new Client({ connectionString: SUPERUSER_URL });
    await client.connect();
    try {
      // A policy that is forced, enabled, and present — but grants every
      // row to every session regardless of tenant. `EXISTS (SELECT 1 FROM
      // pg_policy ...)` alone would call this "protected"; it is the exact
      // shape the audit is supposed to catch.
      await client.query(`
        CREATE TABLE library."${TABLE}" ("id" uuid PRIMARY KEY, "orgId" uuid NOT NULL);
        ALTER TABLE library."${TABLE}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE library."${TABLE}" FORCE ROW LEVEL SECURITY;
        CREATE POLICY permissive_leak ON library."${TABLE}" USING (true) WITH CHECK (true);
      `);

      const result = await auditRlsCoverage(getLibraryPlatformPrisma());
      expect(result.unprotected).toContain(TABLE);
      expect(result.ok).toBe(false);
    } finally {
      await client.query(`DROP TABLE IF EXISTS library."${TABLE}"`);
      await client.end();
    }
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
