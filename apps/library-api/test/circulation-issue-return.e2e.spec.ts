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
import { computeFine, type Policy } from '../src/modules/circulation';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/** A far-future placeholder for a PENDING hold's (non-null) `expiresAt` —
 * see `loans.service.ts`'s `promoteOrRelease` doc: a PENDING hold's expiry
 * only becomes meaningful once it is promoted to READY (Task 9's hold-shelf
 * countdown), so a placeholder this far out is never mistaken for "already
 * expired" by `nextHoldToPromote`. */
const FAR_FUTURE = new Date(Date.now() + 365 * 86_400_000);
const FOURTEEN_DAYS_OUT = new Date(Date.now() + 14 * 86_400_000);

const POLICY: Policy = {
  maxBooks: 5,
  loanDays: 14,
  renewLimit: 2,
  renewDays: 14,
  finePerDay: 5,
  graceDays: 1,
  maxFine: 500,
  maxHolds: 3,
  holdShelfDays: 3,
  maxOutstandingFine: 1000,
};

interface CircOrg {
  orgId: string;
  slug: string;
  branchId: string;
  librarianToken: string;
}

const host = (org: Pick<CircOrg, 'slug'>) => `${org.slug}.library.trackyour.in`;

async function seedCircOrg(suffix: string): Promise<CircOrg> {
  const prisma = getLibraryPlatformPrisma();
  const org = await prisma.libraryOrg.create({ data: { slug: `circ-${suffix}`, name: 'Circ E2E', status: 'LIVE' } });
  const branch = await prisma.branch.create({ data: { orgId: org.id, name: 'Main', code: 'MAIN' } });
  await prisma.circulationPolicy.create({ data: { orgId: org.id, memberType: 'STUDENT', ...POLICY } });

  const passwordHash = await argon2.hash('circ-e2e-Pw1!', { type: argon2.argon2id });
  const librarian = await prisma.libUser.create({
    data: { orgId: org.id, email: `librarian-${suffix}@circ.test`, passwordHash, role: 'LIBRARIAN', branchIds: [], active: true },
  });
  const jwt = new JwtService(); // standalone, no Nest DI — same pattern as test/helpers/live-db.ts
  const librarianToken = signAccessToken(jwt, {
    id: librarian.id, orgId: librarian.orgId, role: librarian.role, branchIds: librarian.branchIds,
  });

  return { orgId: org.id, slug: org.slug, branchId: branch.id, librarianToken };
}

function seedMember(orgId: string, branchId: string, code: string, memberType: 'STUDENT' | 'TEACHER' | 'EXTERNAL' = 'STUDENT') {
  return getLibraryPlatformPrisma().member.create({
    data: { orgId, homeBranchId: branchId, code, firstName: 'Circ', lastName: code, status: 'ACTIVE', memberType },
  });
}

function seedTitle(orgId: string, label: string) {
  return getLibraryPlatformPrisma().title.create({ data: { orgId, title: `Circulation E2E — ${label}` } });
}

function seedCopy(orgId: string, branchId: string, titleId: string, barcode: string) {
  return getLibraryPlatformPrisma().copy.create({ data: { orgId, titleId, branchId, barcode } });
}

async function cleanup(orgId: string): Promise<void> {
  await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
}

describeLive('circulation desk — issue and return (Task 8)', () => {
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

  describe('full flow: issue -> return on time (no fine) -> issue -> return late (fine to the rupee)', () => {
    let org: CircOrg;
    let member: { id: string };
    let copy: { id: string; barcode: string };

    beforeAll(async () => {
      org = await seedCircOrg(`full-${Date.now().toString(36)}`);
      member = await seedMember(org.orgId, org.branchId, 'FULL-M1');
      const title = await seedTitle(org.orgId, 'full-flow');
      copy = await seedCopy(org.orgId, org.branchId, title.id, `FULL-${Date.now()}`);
    });
    afterAll(() => cleanup(org.orgId));

    const issue = () =>
      request(app.getHttpServer())
        .post('/circulation/issue')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ barcode: copy.barcode, memberId: member.id });

    const doReturn = () =>
      request(app.getHttpServer())
        .post('/circulation/return')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ barcode: copy.barcode });

    it('issues the copy: Loan created, Copy -> ON_LOAN', async () => {
      const res = await issue();
      expect(res.status).toBe(201);
      expect(res.body.loan.memberId).toBe(member.id);
      expect(res.body.loan.returnedAt).toBeNull();

      const dbCopy = await getLibraryPlatformPrisma().copy.findUnique({ where: { id: copy.id } });
      expect(dbCopy?.status).toBe('ON_LOAN');
    });

    it('returns on time: no Fine row, Copy -> AVAILABLE', async () => {
      const res = await doReturn();
      expect(res.status).toBe(201);
      expect(res.body.fine).toBeNull();
      expect(res.body.copyStatus).toBe('AVAILABLE');

      const dbCopy = await getLibraryPlatformPrisma().copy.findUnique({ where: { id: copy.id } });
      expect(dbCopy?.status).toBe('AVAILABLE');
      const fines = await getLibraryPlatformPrisma().fine.findMany({ where: { memberId: member.id } });
      expect(fines).toHaveLength(0);
    });

    it('issues again', async () => {
      const res = await issue();
      expect(res.status).toBe(201);
    });

    it('returns late: Fine amount matches computeFine to the rupee', async () => {
      // Force the loan overdue by backdating dueAt directly — there is no
      // clock to fake through the HTTP layer, and the controller reads
      // `new Date()` itself (see circulation.controller.ts's own comment on
      // why: the clock is read exactly once per request, not injected).
      const activeLoan = await getLibraryPlatformPrisma().loan.findFirst({ where: { copyId: copy.id, returnedAt: null } });
      const pastDue = new Date(Date.now() - 5 * 86_400_000);
      await getLibraryPlatformPrisma().loan.update({ where: { id: activeLoan!.id }, data: { dueAt: pastDue } });

      const res = await doReturn();
      expect(res.status).toBe(201);
      expect(res.body.fine).not.toBeNull();

      // computeFine against the EXACT `now` the server used (its own
      // `returnedAt`), not a fresh `new Date()` here — avoids any clock-skew
      // flake between test and server process.
      const serverNow = new Date(res.body.loan.returnedAt);
      const expected = computeFine(POLICY, pastDue, serverNow);
      expect(expected.amount).toBeGreaterThan(0); // sanity: the fixture actually produced an overdue fine
      expect(Number(res.body.fine.amount)).toBe(expected.amount);
      expect(res.body.fine.reason).toBe(`${expected.days} day(s) overdue`);

      const dbFine = await getLibraryPlatformPrisma().fine.findFirst({ where: { loanId: activeLoan!.id } });
      expect(Number(dbFine?.amount)).toBe(expected.amount);
    });
  });

  describe('issuing a copy already on loan is denied', () => {
    let org: CircOrg;
    let memberA: { id: string };
    let memberB: { id: string };
    let copy: { id: string; barcode: string };

    beforeAll(async () => {
      org = await seedCircOrg(`unavail-${Date.now().toString(36)}`);
      memberA = await seedMember(org.orgId, org.branchId, 'UNAVAIL-A');
      memberB = await seedMember(org.orgId, org.branchId, 'UNAVAIL-B');
      const title = await seedTitle(org.orgId, 'unavailable');
      copy = await seedCopy(org.orgId, org.branchId, title.id, `UNAVAIL-${Date.now()}`);
    });
    afterAll(() => cleanup(org.orgId));

    it('first issue succeeds, second (same copy, different member) is a 409 COPY_NOT_AVAILABLE', async () => {
      const issueAs = (memberId: string) =>
        request(app.getHttpServer())
          .post('/circulation/issue')
          .set('X-Library-Host', host(org))
          .set('Authorization', `Bearer ${org.librarianToken}`)
          .send({ barcode: copy.barcode, memberId });

      const first = await issueAs(memberA.id);
      expect(first.status).toBe(201);

      const second = await issueAs(memberB.id);
      expect(second.status).toBe(409);
      expect(second.body.reason).toBe('COPY_NOT_AVAILABLE');
    });
  });

  describe('returning a barcode with no active loan', () => {
    let org: CircOrg;
    let copy: { id: string; barcode: string };

    beforeAll(async () => {
      org = await seedCircOrg(`noloan-${Date.now().toString(36)}`);
      const title = await seedTitle(org.orgId, 'no-active-loan');
      copy = await seedCopy(org.orgId, org.branchId, title.id, `NOLOAN-${Date.now()}`);
    });
    afterAll(() => cleanup(org.orgId));

    it('404s', async () => {
      const res = await request(app.getHttpServer())
        .post('/circulation/return')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ barcode: copy.barcode });
      expect(res.status).toBe(404);
    });
  });

  describe('a copy on the hold shelf', () => {
    let org: CircOrg;
    let heldMember: { id: string };
    let otherMember: { id: string };
    let title: { id: string };

    beforeAll(async () => {
      org = await seedCircOrg(`shelf-${Date.now().toString(36)}`);
      heldMember = await seedMember(org.orgId, org.branchId, 'SHELF-HELD');
      otherMember = await seedMember(org.orgId, org.branchId, 'SHELF-OTHER');
      title = await seedTitle(org.orgId, 'hold-shelf');
    });
    afterAll(() => cleanup(org.orgId));

    it('issuing to the held member collects the hold in the same transaction', async () => {
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `SHELF-COLLECT-${Date.now()}`);
      const hold = await getLibraryPlatformPrisma().hold.create({
        data: {
          orgId: org.orgId, titleId: title.id, memberId: heldMember.id, queuePosition: 1,
          status: 'READY', readyCopyId: copy.id, readyAt: new Date(), expiresAt: FAR_FUTURE,
        },
      });
      await getLibraryPlatformPrisma().copy.update({ where: { id: copy.id }, data: { status: 'ON_HOLD_SHELF' } });

      const res = await request(app.getHttpServer())
        .post('/circulation/issue')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ barcode: copy.barcode, memberId: heldMember.id });

      expect(res.status).toBe(201);
      expect(res.body.collectedHoldId).toBe(hold.id);

      const dbHold = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold.id } });
      expect(dbHold?.status).toBe('COLLECTED');
    });

    it('issuing to a DIFFERENT member is denied 409 COPY_ON_HOLD_FOR_OTHER', async () => {
      const copy = await seedCopy(org.orgId, org.branchId, title.id, `SHELF-DENY-${Date.now()}`);
      await getLibraryPlatformPrisma().hold.create({
        data: {
          orgId: org.orgId, titleId: title.id, memberId: heldMember.id, queuePosition: 1,
          status: 'READY', readyCopyId: copy.id, readyAt: new Date(), expiresAt: FAR_FUTURE,
        },
      });
      await getLibraryPlatformPrisma().copy.update({ where: { id: copy.id }, data: { status: 'ON_HOLD_SHELF' } });

      const res = await request(app.getHttpServer())
        .post('/circulation/issue')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ barcode: copy.barcode, memberId: otherMember.id });

      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('COPY_ON_HOLD_FOR_OTHER');
    });
  });

  describe('returning a copy promotes the next pending hold and writes the outbox row', () => {
    let org: CircOrg;
    let borrower: { id: string };
    let waiter: { id: string };
    let title: { id: string };
    let copy: { id: string; barcode: string };
    let hold: { id: string };

    beforeAll(async () => {
      org = await seedCircOrg(`hold-return-${Date.now().toString(36)}`);
      borrower = await seedMember(org.orgId, org.branchId, 'HR-BORROW');
      waiter = await seedMember(org.orgId, org.branchId, 'HR-WAIT');
      title = await seedTitle(org.orgId, 'hold-return');
      copy = await seedCopy(org.orgId, org.branchId, title.id, `HR-${Date.now()}`);

      const prisma = getLibraryPlatformPrisma();
      await prisma.loan.create({ data: { orgId: org.orgId, copyId: copy.id, branchId: org.branchId, memberId: borrower.id, dueAt: FOURTEEN_DAYS_OUT } });
      await prisma.copy.update({ where: { id: copy.id }, data: { status: 'ON_LOAN' } });
      hold = await prisma.hold.create({
        data: { orgId: org.orgId, titleId: title.id, memberId: waiter.id, queuePosition: 1, status: 'PENDING', expiresAt: FAR_FUTURE },
      });
    });
    afterAll(() => cleanup(org.orgId));

    it('promotes the hold onto the returned copy; the outbox carries a durable HOLD_READY row, not a sent message', async () => {
      const res = await request(app.getHttpServer())
        .post('/circulation/return')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.librarianToken}`)
        .send({ barcode: copy.barcode });

      expect(res.status).toBe(201);
      expect(res.body.promotedHoldId).toBe(hold.id);
      expect(res.body.copyStatus).toBe('ON_HOLD_SHELF');

      const dbHold = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold.id } });
      expect(dbHold?.status).toBe('READY');
      expect(dbHold?.readyCopyId).toBe(copy.id);
      expect(dbHold?.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const dbCopy = await getLibraryPlatformPrisma().copy.findUnique({ where: { id: copy.id } });
      expect(dbCopy?.status).toBe('ON_HOLD_SHELF');

      const outboxRows = await getLibraryPlatformPrisma().notificationOutbox.findMany({
        where: { orgId: org.orgId, templateKey: 'HOLD_READY' },
      });
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0].to).toBe(waiter.id);
      expect(outboxRows[0].channel).toBe('INAPP');
      // Nothing drains this table until Phase 4 (see NotificationOutbox's
      // own schema doc) — asserted as a durable row, never as "sent".
      expect(outboxRows[0].sentAt).toBeNull();
    });
  });

  /**
   * Regression proof for `docs/superpowers/LIBRARY-TRAPS.md` trap 3 applied
   * to hold promotion specifically: `SELECT ... FOR UPDATE` on the title's
   * PENDING holds is what stops two simultaneous returns of two DIFFERENT
   * copies of the SAME title from both reading "hold X is next" and both
   * promoting it. Manually verified to discriminate during development by
   * temporarily removing the `FOR UPDATE` clause from
   * `loans.service.ts`'s `promoteOrRelease` query and re-running this exact
   * test: both copies ended up `ON_HOLD_SHELF`, the single Hold row was
   * left pointing at only ONE of them (last-writer-wins on `readyCopyId`),
   * and TWO `HOLD_READY` outbox rows were written for the same hold — see
   * task-8-report.md for the captured before/after. Restoring `FOR UPDATE`
   * makes this pass again.
   */
  describe('hold promotion under concurrency', () => {
    let org: CircOrg;
    let waiter: { id: string };
    let borrowerX: { id: string };
    let borrowerY: { id: string };
    let title: { id: string };
    let copyX: { id: string; barcode: string };
    let copyY: { id: string; barcode: string };
    let hold: { id: string };

    beforeAll(async () => {
      org = await seedCircOrg(`hold-race-${Date.now().toString(36)}`);
      waiter = await seedMember(org.orgId, org.branchId, 'HRACE-WAIT');
      borrowerX = await seedMember(org.orgId, org.branchId, 'HRACE-X');
      borrowerY = await seedMember(org.orgId, org.branchId, 'HRACE-Y');
      title = await seedTitle(org.orgId, 'hold-race');
      copyX = await seedCopy(org.orgId, org.branchId, title.id, `HRACE-X-${Date.now()}`);
      copyY = await seedCopy(org.orgId, org.branchId, title.id, `HRACE-Y-${Date.now()}`);

      const prisma = getLibraryPlatformPrisma();
      await prisma.loan.create({ data: { orgId: org.orgId, copyId: copyX.id, branchId: org.branchId, memberId: borrowerX.id, dueAt: FOURTEEN_DAYS_OUT } });
      await prisma.copy.update({ where: { id: copyX.id }, data: { status: 'ON_LOAN' } });
      await prisma.loan.create({ data: { orgId: org.orgId, copyId: copyY.id, branchId: org.branchId, memberId: borrowerY.id, dueAt: FOURTEEN_DAYS_OUT } });
      await prisma.copy.update({ where: { id: copyY.id }, data: { status: 'ON_LOAN' } });

      hold = await prisma.hold.create({
        data: { orgId: org.orgId, titleId: title.id, memberId: waiter.id, queuePosition: 1, status: 'PENDING', expiresAt: FAR_FUTURE },
      });
    });
    afterAll(() => cleanup(org.orgId));

    it('two simultaneous returns of two copies of the same title promote the single pending hold exactly once', async () => {
      const returnCopy = (barcode: string) =>
        request(app.getHttpServer())
          .post('/circulation/return')
          .set('X-Library-Host', host(org))
          .set('Authorization', `Bearer ${org.librarianToken}`)
          .send({ barcode });

      // Fired together, not sequentially awaited — both requests are
      // genuinely in flight, each in its own `withOrg` transaction, so the
      // FOR UPDATE lock is the thing actually being exercised, not JS-side
      // ordering.
      const [r1, r2] = await Promise.all([returnCopy(copyX.barcode), returnCopy(copyY.barcode)]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const promotedIds = [r1.body.promotedHoldId, r2.body.promotedHoldId].filter((id) => id !== null);
      expect(promotedIds).toEqual([hold.id]); // exactly ONE of the two promoted it

      const statuses = [r1.body.copyStatus, r2.body.copyStatus].sort();
      expect(statuses).toEqual(['AVAILABLE', 'ON_HOLD_SHELF']);

      const dbHold = await getLibraryPlatformPrisma().hold.findUnique({ where: { id: hold.id } });
      expect(dbHold?.status).toBe('READY');
      expect([copyX.id, copyY.id]).toContain(dbHold?.readyCopyId);

      const dbCopies = await getLibraryPlatformPrisma().copy.findMany({ where: { id: { in: [copyX.id, copyY.id] } } });
      const shelfCopy = dbCopies.find((c) => c.status === 'ON_HOLD_SHELF');
      const availableCopy = dbCopies.find((c) => c.status === 'AVAILABLE');
      expect(shelfCopy?.id).toBe(dbHold?.readyCopyId); // the promoted copy is the one Hold actually points at
      expect(availableCopy).toBeDefined(); // the loser correctly fell through to AVAILABLE, not left ON_LOAN

      // Not duplicated — without the FOR UPDATE lock, both transactions
      // would have written their own HOLD_READY row for the same hold.
      const outboxRows = await getLibraryPlatformPrisma().notificationOutbox.findMany({
        where: { orgId: org.orgId, templateKey: 'HOLD_READY' },
      });
      expect(outboxRows).toHaveLength(1);
    });
  });

  /**
   * `Idempotency-Key` converges the RESPONSE for a retried barcode-scanner
   * double-fire — it does not, and is documented as not, preventing the
   * HANDLER from running twice for two genuinely concurrent requests (see
   * `IdempotencyInterceptor`'s own class doc and `circulation.controller.ts`).
   * `loan_one_active_per_copy` (Task 4) is what actually prevents a second
   * Loan row. Asserted directly, per the brief.
   */
  describe('Idempotency-Key on /circulation/issue', () => {
    let org: CircOrg;
    let member: { id: string };
    let copy: { id: string; barcode: string };

    beforeAll(async () => {
      org = await seedCircOrg(`idem-${Date.now().toString(36)}`);
      member = await seedMember(org.orgId, org.branchId, 'IDEM-M1');
      const title = await seedTitle(org.orgId, 'idempotency');
      copy = await seedCopy(org.orgId, org.branchId, title.id, `IDEM-${Date.now()}`);
    });
    afterAll(() => cleanup(org.orgId));

    it('two concurrent identical requests with the same key still produce exactly one Loan row and no 500s', async () => {
      const key = `idem-key-${Date.now().toString(36)}`;
      const fire = () =>
        request(app.getHttpServer())
          .post('/circulation/issue')
          .set('X-Library-Host', host(org))
          .set('Authorization', `Bearer ${org.librarianToken}`)
          .set('Idempotency-Key', key)
          .send({ barcode: copy.barcode, memberId: member.id });

      const [r1, r2] = await Promise.all([fire(), fire()]);
      expect(r1.status).toBeLessThan(500);
      expect(r2.status).toBeLessThan(500);

      const loans = await getLibraryPlatformPrisma().loan.findMany({ where: { copyId: copy.id, returnedAt: null } });
      expect(loans).toHaveLength(1);
    });
  });

  /**
   * Regression proof for Task 4's `loan_one_active_per_copy` exercised
   * through the REAL `/circulation/issue` route end to end (loan-constraints
   * e2e.spec.ts already proves the raw index directly against
   * `tx.loan.create`; this proves the SERVICE correctly turns the resulting
   * P2002 into a 409 rather than an unhandled 500). Not re-run here: dropping
   * and recreating the index itself (the "does it discriminate" half of the
   * proof) — that lives in loan-constraints.e2e.spec.ts and is not repeated
   * per guard per consuming module.
   */
  describe('double-issue is impossible through the real endpoint', () => {
    let org: CircOrg;
    let memberA: { id: string };
    let memberB: { id: string };
    let copy: { id: string; barcode: string };

    beforeAll(async () => {
      org = await seedCircOrg(`dbl-${Date.now().toString(36)}`);
      memberA = await seedMember(org.orgId, org.branchId, 'DBL-A');
      memberB = await seedMember(org.orgId, org.branchId, 'DBL-B');
      const title = await seedTitle(org.orgId, 'double-issue');
      copy = await seedCopy(org.orgId, org.branchId, title.id, `DBL-${Date.now()}`);
    });
    afterAll(() => cleanup(org.orgId));

    it('two concurrent issues of the same barcode by different members: exactly one 201, one 409, one Loan row', async () => {
      const issueAs = (memberId: string) =>
        request(app.getHttpServer())
          .post('/circulation/issue')
          .set('X-Library-Host', host(org))
          .set('Authorization', `Bearer ${org.librarianToken}`)
          .send({ barcode: copy.barcode, memberId });

      const [r1, r2] = await Promise.all([issueAs(memberA.id), issueAs(memberB.id)]);
      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const loser = r1.status === 409 ? r1 : r2;
      expect(loser.body.reason).toBe('ALREADY_ON_LOAN');

      const loans = await getLibraryPlatformPrisma().loan.findMany({ where: { copyId: copy.id, returnedAt: null } });
      expect(loans).toHaveLength(1);
    });
  });
});
