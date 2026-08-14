import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { getLibraryPlatformPrisma, disconnectLibrary, withOrg, type LibraryTx } from '@library/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { signAccessToken } from '../src/modules/auth/internal/auth.module';
import type { Policy } from '../src/modules/circulation';
import { overdueIssuesQuery } from '../src/modules/circulation/internal/fines.service';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

const MS_PER_DAY = 86_400_000;

const POLICY: Policy = {
  maxBooks: 5,
  issueDays: 14,
  renewLimit: 2,
  renewDays: 14,
  finePerDay: 5,
  graceDays: 1,
  maxFine: 500,
  maxReservations: 3,
  reservedShelfDays: 3,
  maxOutstandingFine: 1000,
};

interface FinesOrg {
  orgId: string;
  slug: string;
  branchId: string;
  librarianToken: string;
  assistantToken: string;
}

const host = (org: Pick<FinesOrg, 'slug'>) => `${org.slug}.library.trackyour.in`;

/**
 * `timezone` defaults to the schema's own default (`Asia/Kolkata`) when
 * omitted — real orgs never see this parameter; it exists only so the
 * pre-existing "reconciles ... against hand-computed fixtures" suite below
 * (whose fixtures are deliberately UTC-midnight-based, unrelated to this
 * task) can keep asserting against UTC boundaries explicitly, while the new
 * "follows the org's own timezone" suite exercises the real default.
 */
async function seedOrg(suffix: string, timezone?: string): Promise<FinesOrg> {
  const prisma = getLibraryPlatformPrisma();
  const org = await prisma.libraryOrg.create({
    data: { slug: `fines-${suffix}`, name: 'Fines E2E', status: 'LIVE', ...(timezone ? { timezone } : {}) },
  });
  const branch = await prisma.branch.create({ data: { orgId: org.id, name: 'Main', code: 'MAIN' } });
  await prisma.circulationPolicy.create({ data: { orgId: org.id, memberType: 'STUDENT', ...POLICY } });

  const passwordHash = await argon2.hash('fines-e2e-Pw1!', { type: argon2.argon2id });
  const jwt = new JwtService(); // standalone, no Nest DI — same pattern as test/helpers/live-db.ts

  const librarian = await prisma.libUser.create({
    data: { orgId: org.id, email: `librarian-${suffix}@fines.test`, passwordHash, role: 'LIBRARIAN', branchIds: [], active: true },
  });
  const assistant = await prisma.libUser.create({
    data: { orgId: org.id, email: `assistant-${suffix}@fines.test`, passwordHash, role: 'ASSISTANT', branchIds: [], active: true },
  });

  return {
    orgId: org.id,
    slug: org.slug,
    branchId: branch.id,
    librarianToken: signAccessToken(jwt, { id: librarian.id, orgId: librarian.orgId, role: librarian.role, branchIds: librarian.branchIds }),
    assistantToken: signAccessToken(jwt, { id: assistant.id, orgId: assistant.orgId, role: assistant.role, branchIds: assistant.branchIds }),
  };
}

function seedMember(orgId: string, branchId: string, code: string) {
  return getLibraryPlatformPrisma().member.create({
    data: { orgId, homeBranchId: branchId, code, firstName: 'Fines', lastName: code, status: 'ACTIVE', memberType: 'STUDENT' },
  });
}

function seedTitle(orgId: string, label: string) {
  return getLibraryPlatformPrisma().title.create({ data: { orgId, title: `Fines E2E — ${label}` } });
}

function seedCopy(orgId: string, branchId: string, titleId: string, accessionNumber: string) {
  return getLibraryPlatformPrisma().copy.create({ data: { orgId, titleId, branchId, accessionNumber } });
}

async function cleanup(orgId: string): Promise<void> {
  await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
}

describeLive('circulation desk — fines, waivers, overdue, day-report (Task 10)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DISABLE_THROTTLER = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    delete process.env.DISABLE_THROTTLER;
    await app?.close();
    await closeOrgLookupRedis();
    await disconnectLibrary();
  });

  describe('waive', () => {
    let org: FinesOrg;

    beforeAll(async () => {
      org = await seedOrg(`waive-${Date.now().toString(36)}`);
    });
    afterAll(() => cleanup(org.orgId));

    async function seedFine(amount: number, paidAmount = 0) {
      const member = await seedMember(org.orgId, org.branchId, `WV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      return getLibraryPlatformPrisma().fine.create({
        data: { orgId: org.orgId, memberId: member.id, kind: 'OVERDUE', status: 'OPEN', amount, paidAmount, reason: 'test fixture' },
      });
    }

    it('waives the full outstanding balance: writes waivedByUserId/waivedAmount/waivedReason, status -> WAIVED, and an AuditLog row', async () => {
      const fine = await seedFine(45.5);

      const res = await request(app.getHttpServer())
        .post(`/circulation/fines/${fine.id}/waive`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ reason: 'Goodwill waiver — first offense', reasonCode: 'GOODWILL' });

      expect(res.status).toBe(201);
      expect(res.body.fine.status).toBe('WAIVED');
      expect(Number(res.body.fine.waivedAmount)).toBe(45.5);
      expect(res.body.fine.waivedReason).toBe('Goodwill waiver — first offense');
      expect(res.body.fine.waivedByUserId).toBeTruthy();

      const dbFine = await getLibraryPlatformPrisma().fine.findUnique({ where: { id: fine.id } });
      expect(dbFine?.status).toBe('WAIVED');
      expect(Number(dbFine?.waivedAmount)).toBe(45.5);
      expect(dbFine?.waivedReason).toBe('Goodwill waiver — first offense');
      expect(dbFine?.waivedAt).not.toBeNull();

      const audit = await getLibraryPlatformPrisma().auditLog.findFirst({
        where: { orgId: org.orgId, action: 'circulation.fine.waive', entityId: fine.id },
      });
      expect(audit).not.toBeNull();
    });

    it('waives only the outstanding remainder when the fine is PARTIALly paid', async () => {
      const fine = await seedFine(100, 30);
      const res = await request(app.getHttpServer())
        .post(`/circulation/fines/${fine.id}/waive`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ reason: 'Waive the rest', reasonCode: 'HARDSHIP' });
      expect(res.status).toBe(201);
      expect(Number(res.body.fine.waivedAmount)).toBe(70);
    });

    it('waiving an already-waived fine is a 409, not silently accepted', async () => {
      const fine = await seedFine(10);
      const waiveOnce = () =>
        request(app.getHttpServer())
          .post(`/circulation/fines/${fine.id}/waive`)
          .set('X-Library-Host', host(org))
          .set('Authorization', `Bearer ${org.librarianToken}`)
          .send({ reason: 'x', reasonCode: 'GOODWILL' });

      const first = await waiveOnce();
      expect(first.status).toBe(201);
      const second = await waiveOnce();
      expect(second.status).toBe(409);
      expect(second.body.reason).toBe('ALREADY_WAIVED');
    });

    it('waiving a fine with nothing outstanding (fully paid) is a 409', async () => {
      const fine = await seedFine(20, 20);
      const res = await request(app.getHttpServer())
        .post(`/circulation/fines/${fine.id}/waive`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ reason: 'x', reasonCode: 'GOODWILL' });
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('NOTHING_OUTSTANDING');
    });

    it('ASSISTANT is denied — the structural authz-matrix row is the primary proof; this exercises the SAME route directly', async () => {
      const fine = await seedFine(10);
      const res = await request(app.getHttpServer())
        .post(`/circulation/fines/${fine.id}/waive`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.assistantToken}`)
        .send({ reason: 'x', reasonCode: 'GOODWILL' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /circulation/fines', () => {
    let org: FinesOrg;

    beforeAll(async () => {
      org = await seedOrg(`list-${Date.now().toString(36)}`);
    });
    afterAll(() => cleanup(org.orgId));

    it('filters by memberId and status', async () => {
      const memberA = await seedMember(org.orgId, org.branchId, `LIST-A-${Date.now()}`);
      const memberB = await seedMember(org.orgId, org.branchId, `LIST-B-${Date.now()}`);
      const prisma = getLibraryPlatformPrisma();
      await prisma.fine.create({ data: { orgId: org.orgId, memberId: memberA.id, kind: 'OVERDUE', status: 'OPEN', amount: 5 } });
      await prisma.fine.create({ data: { orgId: org.orgId, memberId: memberA.id, kind: 'OVERDUE', status: 'PAID', amount: 5, paidAmount: 5 } });
      await prisma.fine.create({ data: { orgId: org.orgId, memberId: memberB.id, kind: 'OVERDUE', status: 'OPEN', amount: 5 } });

      const res = await request(app.getHttpServer())
        .get('/circulation/fines')
        .query({ memberId: memberA.id, status: 'OPEN' })
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].memberId).toBe(memberA.id);
      expect(res.body[0].status).toBe('OPEN');
    });
  });

  describe('GET /circulation/overdue — index-shaped, proven with EXPLAIN plus the catalog', () => {
    let org: FinesOrg;

    beforeAll(async () => {
      org = await seedOrg(`overdue-${Date.now().toString(36)}`);
    });
    afterAll(() => cleanup(org.orgId));

    it('lists only OPEN issues past dueAt, with daysOverdue computed at read time (never stored)', async () => {
      const member = await seedMember(org.orgId, org.branchId, `OD-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'overdue-list');
      const overdueCopy = await seedCopy(org.orgId, org.branchId, title.id, `OD-OVERDUE-${Date.now()}`);
      const futureCopy = await seedCopy(org.orgId, org.branchId, title.id, `OD-FUTURE-${Date.now()}`);
      const prisma = getLibraryPlatformPrisma();
      const overdueLoan = await prisma.issue.create({
        data: { orgId: org.orgId, copyId: overdueCopy.id, branchId: org.branchId, memberId: member.id, dueAt: new Date(Date.now() - 3 * MS_PER_DAY) },
      });
      await prisma.issue.create({
        data: { orgId: org.orgId, copyId: futureCopy.id, branchId: org.branchId, memberId: member.id, dueAt: new Date(Date.now() + 3 * MS_PER_DAY) },
      });

      const res = await request(app.getHttpServer())
        .get('/circulation/overdue')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((r: { id: string }) => r.id);
      expect(ids).toContain(overdueLoan.id);
      expect(ids).not.toContain(undefined);
      const found = res.body.find((r: { id: string }) => r.id === overdueLoan.id);
      expect(found.daysOverdue).toBeGreaterThanOrEqual(3);
    });

    /**
     * The actual guard: `overdueIssuesQuery` (fines.service.ts) is the SAME
     * SQL the route runs — this test `EXPLAIN`s that exact query, not a
     * hand-retyped copy of it (LIBRARY-TRAPS.md #15). Asserts an Index Scan
     * on `issue_due`, never a Seq Scan. See task-9-10-report.md for the
     * deliberate-break proof (dropping `issue_due` and re-running this exact
     * assertion to watch it fail, then restoring the index).
     */
    it('the overdue query is index-shaped, and issue_due still exists and is valid', async () => {
      // A 1-2 row fixture is NOT a valid proof here: Postgres's cost-based
      // optimizer correctly prefers a Seq Scan over an Index Scan on a tiny
      // table (confirmed live while writing this test — see
      // mistakes/log.mjs's `explain-plan-needs-realistic-row-count`). This
      // seeds a realistic row count, and ANALYZEs afterward so the planner's
      // statistics reflect the bulk insert rather than a stale/empty
      // estimate, so the assertion below is a genuine proof, not an
      // artifact of an empty table.
      const prisma = getLibraryPlatformPrisma();
      const title = await seedTitle(org.orgId, 'explain-fixture');
      const member = await seedMember(org.orgId, org.branchId, `EXPLAIN-${Date.now()}`);

      const N = 3000;
      const stamp = Date.now();
      await prisma.copy.createMany({
        data: Array.from({ length: N }, (_, i) => ({
          orgId: org.orgId, titleId: title.id, branchId: org.branchId, accessionNumber: `EXPLAIN-BULK-${stamp}-${i}`,
        })),
      });
      const copies = await prisma.copy.findMany({ where: { orgId: org.orgId, titleId: title.id }, select: { id: true } });
      const nowMs = Date.now();
      await prisma.issue.createMany({
        data: copies.map((c, i) => ({
          orgId: org.orgId,
          copyId: c.id,
          branchId: org.branchId,
          memberId: member.id,
          // Spread ± N/2 hours around now: roughly half overdue, half not — realistic selectivity for the `dueAt < now` predicate.
          dueAt: new Date(nowMs + (i - N / 2) * 3_600_000),
        })),
      });
      await prisma.$executeRawUnsafe('ANALYZE "Issue"');
      await prisma.$executeRawUnsafe('ANALYZE "Copy"');

      const sql = overdueIssuesQuery(org.orgId, new Date());
      const plan = await withOrg(org.orgId, (tx: LibraryTx) => tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>`EXPLAIN ${sql}`);
      const planText = plan.map((r) => r['QUERY PLAN']).join('\n');

      // eslint-disable-next-line no-console -- captured deliberately for the task report
      console.log('[overdue EXPLAIN]\n' + planText);

      /*
       * Two assertions, both deterministic, replacing one that was not.
       *
       * The original asserted `/Index.*issue_due/` — the specific index by
       * name — and flaked roughly half the time on a long-lived local
       * database: identical code, alternating pass/fail. The cause is not the
       * query. `Issue` reservations every org ever created by every e2e run, so
       * `orgId = X` gets less selective as the table accumulates; the planner
       * eventually estimates ~1 matching row (it printed `rows=1`, cost 4.16)
       * and picks `issue_one_active_per_copy` instead. Both are partial indexes
       * with the same `WHERE "returnedAt" IS NULL`, both are Index Scans, and
       * at that estimated size both are correct choices. The test was
       * asserting a planner preference, which is not a property of this code.
       *
       * So the two real risks are asserted separately and directly:
       *
       *   1. The query stays index-shaped. If someone wraps `dueAt` in a
       *      function or adds an OR that defeats indexing, this query falls
       *      back to reading every issue the org ever made — caught by the
       *      Seq Scan assertion plus requiring an Index Scan on Issue.
       *   2. `issue_due` still exists and is valid. Deleting the migration or
       *      leaving the index INVALID after a failed concurrent build is
       *      caught by reading the catalog, which no planner decision can
       *      make flaky. (This is the risk the deliberate-break proof in
       *      task-9-10-report.md exercised by dropping the index.)
       */
      /*
       * `"?\w+"?` on the INDEX NAME, not `\w+`, and that is not cosmetic.
       *
       * Postgres quotes an identifier in EXPLAIN output only when it needs to —
       * i.e. when it contains uppercase. `issue_due` and
       * `issue_one_active_per_copy` are lowercase and print bare;
       * `Issue_orgId_idx` (Prisma's own naming) prints as `"Issue_orgId_idx"`.
       * A bare `\w+` cannot match a leading double quote, so this assertion
       * silently depended on WHICH index the planner chose — passing for the
       * two hand-written ones and failing for the Prisma-generated one, while
       * the plan in both cases is an Index Scan and the property under test
       * holds perfectly.
       *
       * That is the same failure this block's history describes (asserting a
       * planner preference rather than a property of the code), one level
       * down: the regex, not the index name, was carrying the assumption. It
       * surfaced when P3's new suites shifted the row statistics enough for the
       * planner to prefer `Issue_orgId_idx`.
       */
      expect(planText).not.toMatch(/Seq Scan on "?Issue"?/);
      expect(planText).toMatch(/Index (Only )?Scan using "?\w+"? on "?Issue"?/);

      const [idx] = await prisma.$queryRaw<Array<{ indexdef: string; indisvalid: boolean }>>`
        SELECT i.indexdef, x.indisvalid
        FROM pg_indexes i
        JOIN pg_class c ON c.relname = i.indexname
        JOIN pg_index x ON x.indexrelid = c.oid
        WHERE i.schemaname = 'library' AND i.indexname = 'issue_due'
      `;
      // Missing here means the migration is gone and GET /circulation/overdue
      // would read every issue the org has ever made.
      expect(idx).toBeDefined();
      expect(idx.indisvalid).toBe(true);
      expect(idx.indexdef).toMatch(/"?dueAt"?/);
      expect(idx.indexdef).toMatch(/WHERE .*"?returnedAt"? IS NULL/);
    });
  });

  describe('GET /circulation/day-report — reconciles to the rupee against seeded fixtures', () => {
    let org: FinesOrg;
    const DAY = '2020-06-15';
    const dayStart = new Date(`${DAY}T00:00:00.000Z`);
    const hoursIn = (h: number) => new Date(dayStart.getTime() + h * 3_600_000);

    beforeAll(async () => {
      // Explicit 'UTC' — these fixtures are deliberately UTC-midnight-based
      // (see hoursIn() above); the org's own timezone (Asia/Kolkata by
      // default) is exercised by the dedicated describe block below instead.
      org = await seedOrg(`report-${Date.now().toString(36)}`, 'UTC');
      const branchId = org.branchId;
      const prisma = getLibraryPlatformPrisma();
      const title = await seedTitle(org.orgId, 'day-report');
      const member = await seedMember(org.orgId, branchId, `DR-${Date.now()}`);

      // L1: issued IN the day, due far in the future, still open -> issued+1, NOT overdue at day end.
      const c1 = await seedCopy(org.orgId, branchId, title.id, `DR-1-${Date.now()}`);
      await prisma.issue.create({ data: { orgId: org.orgId, copyId: c1.id, branchId, memberId: member.id, issuedAt: hoursIn(1), dueAt: new Date(dayStart.getTime() + 14 * MS_PER_DAY) } });

      // L2: issued IN the day, due IN the day, never returned -> issued+1, overdue+1 (still outstanding, past due by day end).
      const c2 = await seedCopy(org.orgId, branchId, title.id, `DR-2-${Date.now()}`);
      await prisma.issue.create({ data: { orgId: org.orgId, copyId: c2.id, branchId, memberId: member.id, issuedAt: hoursIn(2), dueAt: hoursIn(3) } });

      // L3: issued IN the day, due IN the day, returned IN the day BEFORE its own dueAt -> issued+1, returned+1, NOT overdue (resolved before day end).
      const c3 = await seedCopy(org.orgId, branchId, title.id, `DR-3-${Date.now()}`);
      await prisma.issue.create({ data: { orgId: org.orgId, copyId: c3.id, branchId, memberId: member.id, issuedAt: hoursIn(3), dueAt: hoursIn(5), returnedAt: hoursIn(4), status: 'RETURNED' } });

      // L4: issued the day BEFORE, due IN the day, never returned -> NOT counted as issued (wrong day), but overdue+1 by this day's end.
      const c4 = await seedCopy(org.orgId, branchId, title.id, `DR-4-${Date.now()}`);
      await prisma.issue.create({ data: { orgId: org.orgId, copyId: c4.id, branchId, memberId: member.id, issuedAt: new Date(dayStart.getTime() - MS_PER_DAY), dueAt: hoursIn(1) } });

      // L5: issued long before, was overdue, but returned IN the day -> returned+1, NOT counted as issued, NOT overdue (resolved before day end).
      const c5 = await seedCopy(org.orgId, branchId, title.id, `DR-5-${Date.now()}`);
      await prisma.issue.create({ data: { orgId: org.orgId, copyId: c5.id, branchId, memberId: member.id, issuedAt: new Date(dayStart.getTime() - 20 * MS_PER_DAY), dueAt: new Date(dayStart.getTime() - 10 * MS_PER_DAY), returnedAt: hoursIn(6), status: 'RETURNED' } });

      // L6: outside the window entirely (issued/due/returned all the day after) -> must not appear in any count.
      const c6 = await seedCopy(org.orgId, branchId, title.id, `DR-6-${Date.now()}`);
      await prisma.issue.create({
        data: { orgId: org.orgId, copyId: c6.id, branchId, memberId: member.id, issuedAt: new Date(dayStart.getTime() + MS_PER_DAY + 3_600_000), dueAt: new Date(dayStart.getTime() + 15 * MS_PER_DAY) },
      });

      // Fines: two accrued IN the day (45.50 + 12.25 = 57.75), one OUTSIDE the day (999, must be excluded).
      await prisma.fine.create({ data: { orgId: org.orgId, memberId: member.id, kind: 'OVERDUE', status: 'OPEN', amount: 45.5, createdAt: hoursIn(2) } });
      await prisma.fine.create({ data: { orgId: org.orgId, memberId: member.id, kind: 'OVERDUE', status: 'OPEN', amount: 12.25, createdAt: hoursIn(7) } });
      await prisma.fine.create({ data: { orgId: org.orgId, memberId: member.id, kind: 'OVERDUE', status: 'OPEN', amount: 999, createdAt: new Date(dayStart.getTime() - MS_PER_DAY) } });
    });
    afterAll(() => cleanup(org.orgId));

    it('reconciles issued/returned/overdue counts and fines-accrued amount exactly, against hand-computed fixtures', async () => {
      const res = await request(app.getHttpServer())
        .get('/circulation/day-report')
        .query({ date: DAY })
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        date: DAY,
        issued: 3, // L1, L2, L3
        returned: 2, // L3, L5
        overdue: 2, // L2, L4
        // Decimal STRING, not a number — see fines.service.ts's
        // `decimalToMoneyString` doc: this is the one money representation
        // used across the whole API now, matching how `Fine.amount` already
        // serialized on every other route.
        finesAccrued: { count: 2, amount: '57.75' },
      });
    });
  });

  /**
   * "Also fix" (Phase 1a review): the day report used UTC calendar-day
   * boundaries regardless of the org's own timezone, which is 5.5 hours
   * wrong for an Indian school (`LibraryOrg.timezone` defaults to
   * `Asia/Kolkata`) — the desk's own "today" and the report's "today"
   * disagreed for any issue in the first 5.5 hours of the IST calendar day
   * (00:00–05:30 IST), which the OLD UTC-midnight boundary still counted as
   * the PREVIOUS UTC day. Fixed by `fines.service.ts`'s `dayRangeForOrg`,
   * which computes the org's own midnight-to-midnight window in Postgres via
   * `AT TIME ZONE` rather than a fixed-offset shift in JS.
   *
   * Every `issuedAt` below is built by parsing a REAL ISO-8601 string with
   * an explicit `+05:30` offset (`new Date(...)`), never by hand-subtracting
   * 5.5 hours — LIBRARY-TRAPS.md #15: verification code must not reimplement
   * the thing it's checking from memory.
   */
  /**
   * The DEFAULT day (no ?date=) must be resolved in the org's timezone.
   *
   * This shipped wrong: the default was `new Date().toISOString().slice(0,10)`
   * — the UTC date — which was then interpreted as a day in the org's zone.
   * For an Asia/Kolkata school those disagree between 18:30 and 24:00 UTC
   * (00:00–05:30 IST), so a book issued at 00:30 IST was reported under the
   * previous day and "today" came back empty.
   *
   * These tests are deliberately time-of-day independent: rather than mocking
   * a clock, they use a zone whose calendar date differs from UTC's RIGHT NOW,
   * whenever "now" happens to be. Pacific/Kiritimati (UTC+14) is always ahead;
   * Pacific/Midway (UTC-11) is always behind. At least one of them disagrees
   * with the UTC date at every instant, so the old bug cannot hide.
   */
  describe('GET /circulation/day-report — the default day is the org\'s day, not UTC\'s', () => {
    it.each([
      ['Pacific/Kiritimati', 'UTC+14 — its calendar date runs ahead of UTC'],
      ['Pacific/Midway', 'UTC-11 — its calendar date runs behind UTC'],
    ])('reports the org\'s own current date in %s (%s)', async (timezone) => {
      const org = await seedOrg(`tzdefault-${Date.now().toString(36)}-${timezone.replace(/\W/g, '').toLowerCase()}`, timezone);
      try {
        const res = await request(app.getHttpServer())
          .get('/circulation/day-report')
          .set('X-Library-Host', host(org))
          .set('Authorization', `Bearer ${org.librarianToken}`)
          .expect(200);

        // What that zone's calendar date actually is at this instant.
        const expected = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());

        expect(res.body.date).toBe(expected);
      } finally {
        await cleanup(org.orgId);
      }
    });

    it('counts a issue issued moments ago, whatever the UTC date happens to be', async () => {
      // Kiritimati is UTC+14, so for 14 hours a day its date is already
      // tomorrow by UTC. Under the old UTC-derived default this returned 0.
      const org = await seedOrg(`tznow-${Date.now().toString(36)}`, 'Pacific/Kiritimati');
      try {
        const member = await seedMember(org.orgId, org.branchId, `TZNOW-${Date.now()}`);
        const title = await seedTitle(org.orgId, 'tz-now');
        const copy = await seedCopy(org.orgId, org.branchId, title.id, `TZNOW-${Date.now()}`);
        await getLibraryPlatformPrisma().issue.create({
          data: {
            orgId: org.orgId,
            copyId: copy.id,
            branchId: org.branchId,
            memberId: member.id,
            dueAt: new Date(Date.now() + 14 * MS_PER_DAY),
          },
        });

        const res = await request(app.getHttpServer())
          .get('/circulation/day-report')
          .set('X-Library-Host', host(org))
          .set('Authorization', `Bearer ${org.librarianToken}`)
          .expect(200);

        expect(res.body.issued).toBe(1);
      } finally {
        await cleanup(org.orgId);
      }
    });
  });

  describe("GET /circulation/day-report — follows the org's own timezone (Asia/Kolkata)", () => {
    let org: FinesOrg;

    beforeAll(async () => {
      // No timezone override -> the schema default, Asia/Kolkata, which is
      // exactly the case this task's proof scenario asks for.
      org = await seedOrg(`ist-${Date.now().toString(36)}`);
    });
    afterAll(() => cleanup(org.orgId));

    const dayReport = (date: string) =>
      request(app.getHttpServer())
        .get('/circulation/day-report')
        .query({ date })
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);

    it('an issue at 21:00 IST lands in THAT calendar day\'s report, not the next', async () => {
      const member = await seedMember(org.orgId, org.branchId, `IST-EVE-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'ist-evening');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `IST-EVE-${Date.now()}`);
      const day = '2026-08-08';
      const issuedAt = new Date(`${day}T21:00:00.000+05:30`);
      await getLibraryPlatformPrisma().issue.create({
        data: {
          orgId: org.orgId, copyId: copy.id, branchId: org.branchId, memberId: member.id,
          issuedAt, dueAt: new Date(issuedAt.getTime() + 14 * MS_PER_DAY),
        },
      });

      const today = await dayReport(day);
      expect(today.status).toBe(200);
      expect(today.body.date).toBe(day);
      expect(today.body.issued).toBeGreaterThanOrEqual(1);

      const tomorrow = await dayReport('2026-08-09');
      expect(tomorrow.body.issued).toBe(0);
    });

    it('an issue at 01:30 IST — inside the old UTC-boundary bug window — lands in the CORRECT IST day, not the previous UTC day', async () => {
      const member = await seedMember(org.orgId, org.branchId, `IST-EARLY-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'ist-early-morning');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `IST-EARLY-${Date.now()}`);
      const day = '2026-08-10';
      // 01:30 IST on the 10th is 20:00 UTC on the 9th — under the OLD
      // UTC-midnight boundary this would have been counted in the 9th's
      // report, not the 10th's, even though the desk's own IST wall clock
      // says it happened on the 10th. This is the actual discriminating
      // case for the bug the task's own words describe.
      const issuedAt = new Date(`${day}T01:30:00.000+05:30`);
      await getLibraryPlatformPrisma().issue.create({
        data: {
          orgId: org.orgId, copyId: copy.id, branchId: org.branchId, memberId: member.id,
          issuedAt, dueAt: new Date(issuedAt.getTime() + 14 * MS_PER_DAY),
        },
      });

      const correctDay = await dayReport(day);
      expect(correctDay.body.issued).toBeGreaterThanOrEqual(1);

      const oldUtcDay = await dayReport('2026-08-09');
      expect(oldUtcDay.body.issued).toBe(0);
    });
  });
});
