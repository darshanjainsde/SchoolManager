import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { signAccessToken } from '../src/modules/auth/internal/auth.module';
import type { Policy } from '../src/modules/circulation';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

const MS_PER_DAY = 86_400_000;
const FOURTEEN_DAYS_OUT = new Date(Date.now() + 14 * MS_PER_DAY);

const POLICY: Policy = {
  maxBooks: 5,
  issueDays: 14,
  renewLimit: 2,
  renewDays: 14,
  finePerDay: 5,
  graceDays: 1,
  maxFine: 500,
  maxHolds: 2,
  holdShelfDays: 3,
  maxOutstandingFine: 1000,
};

interface RHOrg {
  orgId: string;
  slug: string;
  branchId: string;
  librarianToken: string;
}

const host = (org: Pick<RHOrg, 'slug'>) => `${org.slug}.library.trackyour.in`;

async function seedOrg(suffix: string, policyOverrides: Partial<Policy> = {}): Promise<RHOrg> {
  const prisma = getLibraryPlatformPrisma();
  const org = await prisma.libraryOrg.create({ data: { slug: `rh-${suffix}`, name: 'Renew/Holds E2E', status: 'LIVE' } });
  const branch = await prisma.branch.create({ data: { orgId: org.id, name: 'Main', code: 'MAIN' } });
  await prisma.circulationPolicy.create({ data: { orgId: org.id, memberType: 'STUDENT', ...POLICY, ...policyOverrides } });

  const passwordHash = await argon2.hash('rh-e2e-Pw1!', { type: argon2.argon2id });
  const librarian = await prisma.libUser.create({
    data: { orgId: org.id, email: `librarian-${suffix}@rh.test`, passwordHash, role: 'LIBRARIAN', branchIds: [], active: true },
  });
  const jwt = new JwtService(); // standalone, no Nest DI — same pattern as test/helpers/live-db.ts
  const librarianToken = signAccessToken(jwt, {
    id: librarian.id, orgId: librarian.orgId, role: librarian.role, branchIds: librarian.branchIds,
  });

  return { orgId: org.id, slug: org.slug, branchId: branch.id, librarianToken };
}

function seedMember(orgId: string, branchId: string, code: string) {
  return getLibraryPlatformPrisma().member.create({
    data: { orgId, homeBranchId: branchId, code, firstName: 'RH', lastName: code, status: 'ACTIVE', memberType: 'STUDENT' },
  });
}

function seedTitle(orgId: string, label: string) {
  return getLibraryPlatformPrisma().title.create({ data: { orgId, title: `Renew/Holds E2E — ${label}` } });
}

function seedCopy(orgId: string, branchId: string, titleId: string, accessionNumber: string) {
  return getLibraryPlatformPrisma().copy.create({ data: { orgId, titleId, branchId, accessionNumber } });
}

function seedActiveLoan(orgId: string, copyId: string, branchId: string, memberId: string, dueAt: Date) {
  return getLibraryPlatformPrisma().issue.create({ data: { orgId, copyId, branchId, memberId, dueAt } });
}

async function cleanup(orgId: string): Promise<void> {
  await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
}

describeLive('circulation desk — renew and holds (Task 9)', () => {
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

  describe('renew', () => {
    let org: RHOrg;

    beforeAll(async () => {
      org = await seedOrg(`renew-${Date.now().toString(36)}`);
    });
    afterAll(() => cleanup(org.orgId));

    const renew = (accessionNumber: string) =>
      request(app.getHttpServer())
        .post('/circulation/renew')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ accessionNumber });

    it('extends dueAt by renewDays and increments renewCount', async () => {
      const member = await seedMember(org.orgId, org.branchId, `RENEW-OK-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'renew-ok');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `RENEW-OK-${Date.now()}`);
      const issue = await seedActiveLoan(org.orgId, copy.id, org.branchId, member.id, FOURTEEN_DAYS_OUT);

      const before = Date.now();
      const res = await renew(copy.accessionNumber);
      const after = Date.now();

      expect(res.status).toBe(201);
      expect(res.body.issue.renewCount).toBe(1);
      const newDueAt = new Date(res.body.issue.dueAt).getTime();
      // newDueAt = "now" (server-side, read once per request) + renewDays —
      // bracket it against our own before/after wall-clock reads rather than
      // asserting an exact value, since we don't control the server's clock.
      expect(newDueAt).toBeGreaterThanOrEqual(before + POLICY.renewDays * MS_PER_DAY - 2000);
      expect(newDueAt).toBeLessThanOrEqual(after + POLICY.renewDays * MS_PER_DAY + 2000);

      const dbLoan = await getLibraryPlatformPrisma().issue.findUnique({ where: { id: issue.id } });
      expect(dbLoan?.renewCount).toBe(1);
    });

    it('is refused (403 HAS_HOLDS) when the title has a pending hold — the rule that keeps the queue moving', async () => {
      const borrower = await seedMember(org.orgId, org.branchId, `RENEW-HH-BORROW-${Date.now()}`);
      const waiter = await seedMember(org.orgId, org.branchId, `RENEW-HH-WAIT-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'renew-has-holds');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `RENEW-HH-${Date.now()}`);
      await seedActiveLoan(org.orgId, copy.id, org.branchId, borrower.id, FOURTEEN_DAYS_OUT);

      const holdRes = await request(app.getHttpServer())
        .post('/circulation/holds')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ titleId: title.id, memberId: waiter.id });
      expect(holdRes.status).toBe(201);

      const res = await renew(copy.accessionNumber);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('HAS_HOLDS');
    });

    it('is refused (403 RENEW_LIMIT) at the policy renewal limit', async () => {
      const member = await seedMember(org.orgId, org.branchId, `RENEW-LIM-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'renew-limit');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `RENEW-LIM-${Date.now()}`);
      const issue = await seedActiveLoan(org.orgId, copy.id, org.branchId, member.id, FOURTEEN_DAYS_OUT);
      await getLibraryPlatformPrisma().issue.update({ where: { id: issue.id }, data: { renewCount: POLICY.renewLimit } });

      const res = await renew(copy.accessionNumber);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('RENEW_LIMIT');
    });

    it('is refused (403 ALREADY_OVERDUE) once the issue is already overdue', async () => {
      const member = await seedMember(org.orgId, org.branchId, `RENEW-OD-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'renew-overdue');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `RENEW-OD-${Date.now()}`);
      await seedActiveLoan(org.orgId, copy.id, org.branchId, member.id, new Date(Date.now() - MS_PER_DAY));

      const res = await renew(copy.accessionNumber);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('ALREADY_OVERDUE');
    });

    it('404s when the accessionNumber has no active issue', async () => {
      const title = await seedTitle(org.orgId, 'renew-no-issue');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `RENEW-NOLOAN-${Date.now()}`);
      const res = await renew(copy.accessionNumber);
      expect(res.status).toBe(404);
    });
  });

  describe('holds — create, quota, queue ordering, cancel, list', () => {
    let org: RHOrg;

    beforeAll(async () => {
      org = await seedOrg(`holds-${Date.now().toString(36)}`);
    });
    afterAll(() => cleanup(org.orgId));

    const createHold = (titleId: string, memberId: string) =>
      request(app.getHttpServer())
        .post('/circulation/holds')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ titleId, memberId });

    it('assigns queuePosition 1 to the first hold on a title, 2 to the next', async () => {
      const memberA = await seedMember(org.orgId, org.branchId, `QP-A-${Date.now()}`);
      const memberB = await seedMember(org.orgId, org.branchId, `QP-B-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'queue-position');

      const r1 = await createHold(title.id, memberA.id);
      expect(r1.status).toBe(201);
      expect(r1.body.hold.queuePosition).toBe(1);
      expect(r1.body.hold.status).toBe('PENDING');

      const r2 = await createHold(title.id, memberB.id);
      expect(r2.status).toBe(201);
      expect(r2.body.hold.queuePosition).toBe(2);
    });

    it('the same member cannot place a second open hold on the same title (409 ALREADY_HOLDING)', async () => {
      const member = await seedMember(org.orgId, org.branchId, `DUP-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'duplicate-hold');

      const first = await createHold(title.id, member.id);
      expect(first.status).toBe(201);

      const second = await createHold(title.id, member.id);
      expect(second.status).toBe(409);
      expect(second.body.reason).toBe('ALREADY_HOLDING');
    });

    it('maxHolds is enforced per member across titles via assertQuota', async () => {
      const member = await seedMember(org.orgId, org.branchId, `QUOTA-${Date.now()}`);
      const titles = await Promise.all([1, 2, 3].map((n) => seedTitle(org.orgId, `quota-${n}-${Date.now()}`)));

      const r1 = await createHold(titles[0].id, member.id);
      expect(r1.status).toBe(201);
      const r2 = await createHold(titles[1].id, member.id);
      expect(r2.status).toBe(201); // POLICY.maxHolds is 2 for this suite's org

      const r3 = await createHold(titles[2].id, member.id);
      expect(r3.status).toBe(403);
    });

    it('concurrent hold creation on the same title assigns unique, non-colliding queue positions', async () => {
      const memberA = await seedMember(org.orgId, org.branchId, `RACE-A-${Date.now()}`);
      const memberB = await seedMember(org.orgId, org.branchId, `RACE-B-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'hold-create-race');

      const [r1, r2] = await Promise.all([createHold(title.id, memberA.id), createHold(title.id, memberB.id)]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      const positions = [r1.body.hold.queuePosition, r2.body.hold.queuePosition].sort();
      expect(positions).toEqual([1, 2]); // no duplicate, no gap
    });

    /**
     * Phase 1a review finding: `MAX(queuePosition)+1` was scoped to
     * PENDING/READY holds only, so cancelling the hold that currently holds
     * the max position shrinks that set and can reissue the cancelled
     * hold's OLD position to a brand-new hold. Never a live conflict (the
     * cancelled hold is terminal), but two different Hold rows for the same
     * title showing the same `queuePosition` reads as a duplicate from any
     * console listing a title's hold history. Fixed by scoping the MAX to
     * every hold the title has EVER had, regardless of status — a strictly
     * increasing per-title counter, never reused.
     */
    it('cancelling the highest-position hold does not let a later hold reuse its queuePosition', async () => {
      const memberA = await seedMember(org.orgId, org.branchId, `REISSUE-A-${Date.now()}`);
      const memberB = await seedMember(org.orgId, org.branchId, `REISSUE-B-${Date.now()}`);
      const memberC = await seedMember(org.orgId, org.branchId, `REISSUE-C-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'queue-position-reissue');

      const r1 = await createHold(title.id, memberA.id);
      expect(r1.body.hold.queuePosition).toBe(1);
      const r2 = await createHold(title.id, memberB.id);
      expect(r2.body.hold.queuePosition).toBe(2); // this is the one about to be cancelled — currently the max

      const cancelRes = await request(app.getHttpServer())
        .delete(`/circulation/holds/${r2.body.hold.id}`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);
      expect(cancelRes.status).toBe(200);

      const r3 = await createHold(title.id, memberC.id);
      expect(r3.status).toBe(201);
      // Without the fix this would be 2 — the position the just-cancelled
      // hold used, since MAX({PENDING,READY}) after the cancel is only 1.
      expect(r3.body.hold.queuePosition).toBe(3);
    });

    it('GET /circulation/holds reports a stale READY hold as EXPIRED at read time, without anything having swept the stored row', async () => {
      const member = await seedMember(org.orgId, org.branchId, `LAZY-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'lazy-expiry');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `LAZY-${Date.now()}`);
      const hold = await getLibraryPlatformPrisma().hold.create({
        data: {
          orgId: org.orgId, titleId: title.id, memberId: member.id, queuePosition: 1,
          status: 'READY', readyCopyId: copy.id, readyAt: new Date(Date.now() - 10 * MS_PER_DAY),
          expiresAt: new Date(Date.now() - MS_PER_DAY), // already past its shelf window
        },
      });

      const res = await request(app.getHttpServer())
        .get('/circulation/holds')
        .query({ titleId: title.id })
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((h: { id: string }) => h.id === hold.id);
      expect(found.status).toBe('EXPIRED');

      // The stored row is untouched — this was a pure read-time projection,
      // not a write (trap 7: no scheduler/read-path may perform the
      // transition; only the next RETURN for this title does).
      const dbHold = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold.id } });
      expect(dbHold?.status).toBe('READY');
    });

    it('cancels a PENDING hold', async () => {
      const member = await seedMember(org.orgId, org.branchId, `CANCEL-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'cancel-pending');
      const created = await createHold(title.id, member.id);

      const res = await request(app.getHttpServer())
        .delete(`/circulation/holds/${created.body.hold.id}`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);

      expect(res.status).toBe(200);
      expect(res.body.hold.status).toBe('CANCELLED');
    });

    it('cancelling an already-terminal hold is a 409, not silently accepted', async () => {
      const member = await seedMember(org.orgId, org.branchId, `CANCEL2X-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'cancel-twice');
      const created = await createHold(title.id, member.id);
      const holdId = created.body.hold.id;

      const first = await request(app.getHttpServer())
        .delete(`/circulation/holds/${holdId}`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);
      expect(first.status).toBe(200);

      const second = await request(app.getHttpServer())
        .delete(`/circulation/holds/${holdId}`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);
      expect(second.status).toBe(409);
      expect(second.body.reason).toBe('HOLD_NOT_CANCELLABLE');
    });

    it('cancelling a READY hold releases its copy back to AVAILABLE', async () => {
      const borrower = await seedMember(org.orgId, org.branchId, `CR-BORROW-${Date.now()}`);
      const waiter = await seedMember(org.orgId, org.branchId, `CR-WAIT-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'cancel-ready-releases-copy');
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `CR-${Date.now()}`);
      await seedActiveLoan(org.orgId, copy.id, org.branchId, borrower.id, FOURTEEN_DAYS_OUT);

      const holdRes = await createHold(title.id, waiter.id);
      const holdId = holdRes.body.hold.id;

      const returnRes = await request(app.getHttpServer())
        .post('/circulation/return')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ accessionNumber: copy.accessionNumber });
      expect(returnRes.body.promotedHoldId).toBe(holdId);
      expect(returnRes.body.copyStatus).toBe('ON_HOLD_SHELF');

      const cancelRes = await request(app.getHttpServer())
        .delete(`/circulation/holds/${holdId}`)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);
      expect(cancelRes.status).toBe(200);

      const dbCopy = await getLibraryPlatformPrisma().copy.findUnique({ where: { id: copy.id } });
      expect(dbCopy?.status).toBe('AVAILABLE');
    });
  });

  /**
   * The acceptance scenario for Task 9. Three copies of one title, three
   * members queued for it:
   *   1. Return copy A -> promotes hold1 (member1) to READY; hold2 untouched.
   *   2. member1 collects copy A (an ordinary /circulation/issue, same
   *      mechanism Task 8 already proves marks a matching READY hold
   *      COLLECTED) -> hold1 COLLECTED.
   *   3. Return copy B -> hold1 is no longer PENDING, so this promotes
   *      hold2 (member2) to READY.
   *   4. hold2's shelf window is made to have elapsed (backdating
   *      `expiresAt` directly, the same idiom this suite's sibling e2e uses
   *      for `Issue.dueAt` — there is no clock injected through HTTP; the
   *      controller reads `new Date()` once per request, by design).
   *   5. Return copy C -> the sweep in `promoteOrRelease` finds hold2 stale,
   *      expires it and releases copy B to AVAILABLE, then promotes hold3
   *      (member3) onto copy C.
   */
  describe('full lifecycle: two holds -> promote first -> collect -> promote second -> expire -> promote third', () => {
    let org: RHOrg;
    let member1: { id: string };
    let member2: { id: string };
    let member3: { id: string };
    let borrowerA: { id: string };
    let borrowerB: { id: string };
    let borrowerC: { id: string };
    let title: { id: string };
    let copyA: { id: string; accessionNumber: string };
    let copyB: { id: string; accessionNumber: string };
    let copyC: { id: string; accessionNumber: string };
    let hold1Id: string;
    let hold2Id: string;
    let hold3Id: string;

    beforeAll(async () => {
      org = await seedOrg(`lifecycle-${Date.now().toString(36)}`);
      member1 = await seedMember(org.orgId, org.branchId, `LC-M1-${Date.now()}`);
      member2 = await seedMember(org.orgId, org.branchId, `LC-M2-${Date.now()}`);
      member3 = await seedMember(org.orgId, org.branchId, `LC-M3-${Date.now()}`);
      borrowerA = await seedMember(org.orgId, org.branchId, `LC-BA-${Date.now()}`);
      borrowerB = await seedMember(org.orgId, org.branchId, `LC-BB-${Date.now()}`);
      borrowerC = await seedMember(org.orgId, org.branchId, `LC-BC-${Date.now()}`);
      title = await seedTitle(org.orgId, 'lifecycle');
      copyA = await seedCopy(org.orgId, org.branchId, title.id, `LC-A-${Date.now()}`);
      copyB = await seedCopy(org.orgId, org.branchId, title.id, `LC-B-${Date.now()}`);
      copyC = await seedCopy(org.orgId, org.branchId, title.id, `LC-C-${Date.now()}`);
      await seedActiveLoan(org.orgId, copyA.id, org.branchId, borrowerA.id, FOURTEEN_DAYS_OUT);
      await seedActiveLoan(org.orgId, copyB.id, org.branchId, borrowerB.id, FOURTEEN_DAYS_OUT);
      await seedActiveLoan(org.orgId, copyC.id, org.branchId, borrowerC.id, FOURTEEN_DAYS_OUT);
    });
    afterAll(() => cleanup(org.orgId));

    const post = (path: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(path)
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send(body);

    it('step 0: three members queue for the title in order', async () => {
      const r1 = await post('/circulation/holds', { titleId: title.id, memberId: member1.id });
      expect(r1.status).toBe(201);
      expect(r1.body.hold.queuePosition).toBe(1);
      hold1Id = r1.body.hold.id;

      const r2 = await post('/circulation/holds', { titleId: title.id, memberId: member2.id });
      expect(r2.status).toBe(201);
      expect(r2.body.hold.queuePosition).toBe(2);
      hold2Id = r2.body.hold.id;

      const r3 = await post('/circulation/holds', { titleId: title.id, memberId: member3.id });
      expect(r3.status).toBe(201);
      expect(r3.body.hold.queuePosition).toBe(3);
      hold3Id = r3.body.hold.id;
    });

    it('step 1: returning copy A promotes exactly hold1 — hold2 is untouched', async () => {
      const res = await post('/circulation/return', { accessionNumber: copyA.accessionNumber });
      expect(res.status).toBe(201);
      expect(res.body.promotedHoldId).toBe(hold1Id);
      expect(res.body.copyStatus).toBe('ON_HOLD_SHELF');

      const dbHold1 = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold1Id } });
      expect(dbHold1?.status).toBe('READY');
      expect(dbHold1?.readyCopyId).toBe(copyA.id);
      expect(dbHold1?.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const dbHold2 = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold2Id } });
      expect(dbHold2?.status).toBe('PENDING');
      expect(dbHold2?.queuePosition).toBe(2);
    });

    it('step 2: member1 collects copy A — hold1 -> COLLECTED', async () => {
      const res = await post('/circulation/issue', { accessionNumber: copyA.accessionNumber, memberId: member1.id });
      expect(res.status).toBe(201);
      expect(res.body.collectedHoldId).toBe(hold1Id);

      const dbHold1 = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold1Id } });
      expect(dbHold1?.status).toBe('COLLECTED');
      const dbCopyA = await getLibraryPlatformPrisma().copy.findUnique({ where: { id: copyA.id } });
      expect(dbCopyA?.status).toBe('ON_LOAN');
    });

    it('step 3: returning copy B promotes hold2 (hold1 is out of the queue)', async () => {
      const res = await post('/circulation/return', { accessionNumber: copyB.accessionNumber });
      expect(res.status).toBe(201);
      expect(res.body.promotedHoldId).toBe(hold2Id);
      expect(res.body.copyStatus).toBe('ON_HOLD_SHELF');

      const dbHold2 = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold2Id } });
      expect(dbHold2?.status).toBe('READY');
      expect(dbHold2?.readyCopyId).toBe(copyB.id);
    });

    it('step 4: let hold2\'s shelf window elapse (backdate expiresAt — no HTTP-injectable clock exists in this codebase)', async () => {
      await getLibraryPlatformPrisma().hold.update({
        where: { id: hold2Id },
        data: { expiresAt: new Date(Date.now() - MS_PER_DAY) },
      });

      // GET /circulation/holds already reports it EXPIRED at read time, before any return sweeps it.
      const res = await request(app.getHttpServer())
        .get('/circulation/holds')
        .query({ titleId: title.id })
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`);
      const found = res.body.find((h: { id: string }) => h.id === hold2Id);
      expect(found.status).toBe('EXPIRED');
      const dbHold2 = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold2Id } });
      expect(dbHold2?.status).toBe('READY'); // still not written — no sweep has run yet
    });

    it('step 5: returning copy C expires the stale hold2, releases copy B, and promotes hold3 onto copy C', async () => {
      const res = await post('/circulation/return', { accessionNumber: copyC.accessionNumber });
      expect(res.status).toBe(201);
      expect(res.body.promotedHoldId).toBe(hold3Id);
      expect(res.body.copyStatus).toBe('ON_HOLD_SHELF');

      const dbHold2 = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold2Id } });
      expect(dbHold2?.status).toBe('EXPIRED');

      const dbCopyB = await getLibraryPlatformPrisma().copy.findUnique({ where: { id: copyB.id } });
      expect(dbCopyB?.status).toBe('AVAILABLE'); // freed, not re-promoted onto in this same pass

      const dbHold3 = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold3Id } });
      expect(dbHold3?.status).toBe('READY');
      expect(dbHold3?.readyCopyId).toBe(copyC.id);
      expect(dbHold3?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
