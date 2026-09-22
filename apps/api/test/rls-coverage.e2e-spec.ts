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
 *                   "schoolId" to app_current_tenant(). FORCE matters because
 *                   migrations run as the table owner, and an owner is exempt
 *                   without it. The comparison is uuid to uuid on purpose: the
 *                   older `"schoolId"::text = current_setting(...)` shape was
 *                   correct and unindexable, and the test below keeps it from
 *                   coming back.
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

  it('every tenant_iso policy scopes through app_current_tenant()', async () => {
    const p = getPlatformPrisma();
    // A policy that scopes indirectly (an EXISTS against a parent) is correct
    // but must be allow-listed WITH a test proving cross-tenant invisibility,
    // never silently — LIBRARY-TRAPS #5. As of 4 Sept 2026 there is exactly one: EventAudienceSchool, whose tenant_iso is `schoolId = current_tenant OR EXISTS (... e.schoolId = current_tenant)` — an invitee sees only the row naming itself, a host sees its own event's list, and WITH CHECK stays host-only. The policy is correct; the claim that none existed was not. Note the qual check below CANNOT catch this shape, because the string it looks for is present.
    const odd = await p.$queryRawUnsafe<{ tablename: string; qual: string }[]>(`
      SELECT tablename, qual FROM pg_policies
       WHERE policyname = 'tenant_iso'
         AND qual NOT LIKE '%app_current_tenant()%'
    `);
    expect(odd.map((o) => o.tablename)).toEqual([]);
  });

  /**
   * No policy may compare a CAST of the tenant column.
   *
   * `"schoolId"::text = current_setting(...)` is correct and was in place for
   * a year, and it is also the reason no tenant read could use an index on
   * "schoolId": a btree on a uuid column cannot answer a predicate on
   * `uuid::text`, so Postgres scanned the whole index (or the whole table) and
   * filtered afterwards. Measured on a 30-school copy of Attendance, a class's
   * month of attendance went 46 ms → 2 ms and a tenant-wide count 1,399 ms →
   * 31 ms purely from removing the cast.
   *
   * The failure mode is what makes this a test rather than a comment: it is
   * invisible until there are enough schools in the table, it never returns a
   * wrong answer, and it reappears the moment someone writes the "obvious"
   * policy for a new table by copying the old shape.
   */
  it('no policy casts a tenant column, which would make it unindexable', async () => {
    const p = getPlatformPrisma();
    const casting = await p.$queryRawUnsafe<{ tablename: string; policyname: string }[]>(`
      SELECT tablename, policyname FROM pg_policies
       WHERE schemaname = 'public'
         AND (coalesce(qual, '') LIKE '%)::text = current_setting%'
           OR coalesce(with_check, '') LIKE '%)::text = current_setting%')
    `);
    expect(casting.map((c) => `${c.tablename}.${c.policyname}`)).toEqual([]);
  });

  /**
   * The check above reads only tables that HAVE a "schoolId" column, which is
   * how it decides what is a tenant table. A table keyed solely on a parent's
   * id — `Thing(id, invoiceId)` with no "schoolId" — is therefore exempt from
   * every assertion in this file, and would ship with no policy at all while
   * this suite stayed green.
   *
   * So the set of tables with no "schoolId" is pinned. Today it is six and
   * every one of them is deliberate: School matches on its own id, and the
   * rest are platform-only. Adding a seventh is a decision, and it should
   * cost a conversation rather than nothing.
   */
  it('the tables exempt from the schoolId rule are exactly the ones we chose', async () => {
    const p = getPlatformPrisma();
    const exempt = await p.$queryRawUnsafe<{ table: string }[]>(`
      SELECT c.relname AS "table"
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND c.relname <> '_prisma_migrations'
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = 'public'
              AND col.table_name = c.relname
              AND col.column_name = 'schoolId')
       ORDER BY 1
    `);
    expect(exempt.map((e) => e.table)).toEqual([
      'LeadActivity',
      'MarketingConfig',
      'MarketingLead',
      'MetricRollup',
      'PasswordResetToken',
      'School',
    ]);
  });
});
