import { getPlatformPrisma, disconnectAll } from '@skoolos/db';

/**
 * RLS coverage — the whole schema, not one feature.
 *
 * Written while auditing Homecoming, because the thing worth checking was never
 * "are my eight tables protected" (a test I wrote can only prove what I already
 * thought of) but "can ANY table carrying schoolId reach production without a
 * policy". A new table with no policy is invisible to every feature test: it
 * behaves perfectly for the tenant who created the row.
 *
 * Two shapes are legitimate and the guard accepts both:
 *
 *   tenant_iso    — the ordinary case. ENABLE + FORCE + a policy comparing
 *                   "schoolId"::text to app.current_tenant. FORCE matters
 *                   because migrations run as the table owner, and an owner is
 *                   exempt without it.
 *   platform_only — a table the tenant role must never touch at all (BlogPost,
 *                   SchoolBlogSelection, ImpersonationToken). Its qual is
 *                   literally `false`, and it is deliberately NOT forced so the
 *                   platform client, which owns the tables, still reaches them.
 *
 * Anything else is a finding.
 */
describe('RLS coverage across every tenant table', () => {
  let rows: {
    table: string;
    rls: boolean;
    forced: boolean;
    tenantIso: number;
    platformOnly: number;
  }[];

  beforeAll(async () => {
    const p = getPlatformPrisma();
    rows = await p.$queryRawUnsafe(`
      SELECT c.relname                          AS "table",
             c.relrowsecurity                   AS "rls",
             c.relforcerowsecurity              AS "forced",
             (SELECT count(*)::int FROM pg_policies pp
                WHERE pp.tablename = c.relname AND pp.policyname = 'tenant_iso')    AS "tenantIso",
             (SELECT count(*)::int FROM pg_policies pp
                WHERE pp.tablename = c.relname AND pp.policyname = 'platform_only') AS "platformOnly"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
           WHERE col.table_schema = 'public'
             AND col.table_name = c.relname
             AND col.column_name = 'schoolId'
        )
      ORDER BY c.relname
    `);
  });

  afterAll(async () => {
    await disconnectAll();
  });

  /**
   * The floor. An RLS audit that runs against a database with no tables passes
   * every assertion below and reports success — that exact false green is in
   * this project's mistake ledger, so the guard proves it had something to look
   * at before it claims anything.
   */
  it('actually found the schema (not a vacuous pass against an empty database)', () => {
    expect(rows.length).toBeGreaterThan(50);
  });

  it('every table carrying schoolId is protected, by one shape or the other', () => {
    const unprotected = rows.filter((r) => {
      const tenantScoped = r.rls && r.forced && r.tenantIso === 1;
      const platformOnly = r.rls && r.platformOnly === 1;
      return !tenantScoped && !platformOnly;
    });
    // Named, not counted: a failure should say WHICH table, because the fix is
    // per-table and a bare count sends someone hunting.
    expect(unprotected.map((r) => r.table)).toEqual([]);
  });

  it('no tenant-scoped table is left unforced', () => {
    // Without FORCE the owner is exempt, and migrations plus any tooling that
    // connects as the owner would silently see every school's rows.
    const unforced = rows.filter((r) => r.tenantIso === 1 && !r.forced);
    expect(unforced.map((r) => r.table)).toEqual([]);
  });

  it('the Homecoming tables are in the protected set', () => {
    const mine = [
      'Alumni', 'AlumniBatch', 'AlumniClaim',
      'GiftItem', 'GiftPledge', 'GiftReceipt', 'GiftDistribution',
      'GuestSession',
    ];
    // Names, not booleans: a failure has to say which table, because a bare
    // `false` sends the next person hunting through eight of them. (jest's
    // expect takes no message argument — that is vitest, which apps/web uses.)
    const unprotected = mine.filter((t) => {
      const row = rows.find((r) => r.table === t);
      return !row || !(row.rls && row.forced && row.tenantIso === 1);
    });
    expect(unprotected).toEqual([]);
  });

  it('every tenant_iso policy compares against app.current_tenant', async () => {
    const p = getPlatformPrisma();
    // A policy that scopes indirectly (an EXISTS against a parent) is correct
    // but must be allow-listed WITH a test proving cross-tenant invisibility,
    // never silently — LIBRARY-TRAPS #5. Today there are none.
    const odd = await p.$queryRawUnsafe<{ tablename: string; qual: string }[]>(`
      SELECT tablename, qual FROM pg_policies
       WHERE policyname = 'tenant_iso'
         AND qual NOT LIKE '%app.current_tenant%'
    `);
    expect(odd.map((o) => o.tablename)).toEqual([]);
  });
});
