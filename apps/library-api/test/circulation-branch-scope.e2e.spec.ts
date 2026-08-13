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

/**
 * Phase 1a whole-branch review finding: the catalogue enforces branch scope
 * in both the guard and the service; circulation enforced none. Today an
 * ASSISTANT scoped to branch A can issue, return and renew any branch-B
 * copy, and `/circulation/reservations`, `/fines`, `/overdue`, `/day-report` all
 * return org-wide data. This suite is the same shape as
 * `catalog-branch-scope.e2e.spec.ts` — real app, real HTTP, real JWTs —
 * because the defect (and the fix) is specifically about how the guard, the
 * service, and the real request pipeline behave wired together, which a
 * guard-in-isolation test cannot see.
 */
describeLive('circulation — branch scope is enforced (Phase 1a review)', () => {
  let app: INestApplication;

  interface BranchScopeOrg {
    orgId: string;
    slug: string;
    branchAId: string;
    branchBId: string;
    scopedAssistantToken: string; // ASSISTANT, branches: [branchAId]
    scopedLibrarianToken: string; // LIBRARIAN, branches: [branchAId]
    allBranchesLibrarianToken: string; // LIBRARIAN, branches: []
  }

  const host = (o: Pick<BranchScopeOrg, 'slug'>) => `${o.slug}.library.trackyour.in`;

  async function seedOrg(suffix: string): Promise<BranchScopeOrg> {
    const prisma = getLibraryPlatformPrisma();
    const org = await prisma.libraryOrg.create({ data: { slug: `circbranch-${suffix}`, name: 'Circ Branch Scope E2E', status: 'LIVE' } });
    const branchA = await prisma.branch.create({ data: { orgId: org.id, name: 'Branch A', code: 'BR-A' } });
    const branchB = await prisma.branch.create({ data: { orgId: org.id, name: 'Branch B', code: 'BR-B' } });
    await prisma.circulationPolicy.create({ data: { orgId: org.id, memberType: 'STUDENT', ...POLICY } });

    const passwordHash = await argon2.hash('circ-branch-e2e-Pw1!', { type: argon2.argon2id });
    const jwt = new JwtService(); // standalone, no Nest DI — same pattern as test/helpers/live-db.ts

    const scopedAssistant = await prisma.libUser.create({
      data: { orgId: org.id, email: `assistant-a-${suffix}@circbranch.test`, passwordHash, role: 'ASSISTANT', branchIds: [branchA.id], active: true },
    });
    const scopedLibrarian = await prisma.libUser.create({
      data: { orgId: org.id, email: `librarian-a-${suffix}@circbranch.test`, passwordHash, role: 'LIBRARIAN', branchIds: [branchA.id], active: true },
    });
    const allBranchesLibrarian = await prisma.libUser.create({
      data: { orgId: org.id, email: `librarian-all-${suffix}@circbranch.test`, passwordHash, role: 'LIBRARIAN', branchIds: [], active: true },
    });

    return {
      orgId: org.id,
      slug: org.slug,
      branchAId: branchA.id,
      branchBId: branchB.id,
      scopedAssistantToken: signAccessToken(jwt, {
        id: scopedAssistant.id, orgId: scopedAssistant.orgId, role: scopedAssistant.role, branchIds: scopedAssistant.branchIds,
      }),
      scopedLibrarianToken: signAccessToken(jwt, {
        id: scopedLibrarian.id, orgId: scopedLibrarian.orgId, role: scopedLibrarian.role, branchIds: scopedLibrarian.branchIds,
      }),
      allBranchesLibrarianToken: signAccessToken(jwt, {
        id: allBranchesLibrarian.id, orgId: allBranchesLibrarian.orgId, role: allBranchesLibrarian.role, branchIds: allBranchesLibrarian.branchIds,
      }),
    };
  }

  function seedMember(orgId: string, branchId: string, code: string) {
    return getLibraryPlatformPrisma().member.create({
      data: { orgId, homeBranchId: branchId, code, firstName: 'CircBranch', lastName: code, status: 'ACTIVE', memberType: 'STUDENT' },
    });
  }
  function seedTitle(orgId: string, label: string) {
    return getLibraryPlatformPrisma().title.create({ data: { orgId, title: `Circ Branch Scope E2E — ${label}` } });
  }
  function seedCopy(orgId: string, branchId: string, titleId: string, accessionNumber: string) {
    return getLibraryPlatformPrisma().copy.create({ data: { orgId, titleId, branchId, accessionNumber } });
  }
  async function cleanup(orgId: string): Promise<void> {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
  }

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

  describe('issue / return / renew — enforced against the LOADED copy/issue\'s own branch', () => {
    let org: BranchScopeOrg;
    let memberA: { id: string };
    let memberB: { id: string };
    let title: { id: string };

    beforeAll(async () => {
      org = await seedOrg(`desk-${Date.now().toString(36)}`);
      memberA = await seedMember(org.orgId, org.branchAId, `DESK-A-${Date.now()}`);
      memberB = await seedMember(org.orgId, org.branchBId, `DESK-B-${Date.now()}`);
      title = await seedTitle(org.orgId, 'desk');
    });
    afterAll(() => cleanup(org.orgId));

    const issueAs = (token: string, accessionNumber: string, memberId: string) =>
      request(app.getHttpServer())
        .post('/circulation/issue')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${token}`)
        .send({ accessionNumber, memberId });

    it('an ASSISTANT scoped to branch A is denied issuing a branch-B copy', async () => {
      const copyB = await seedCopy(org.orgId, org.branchBId, title.id, `DESK-DENY-${Date.now()}`);
      const res = await issueAs(org.scopedAssistantToken, copyB.accessionNumber, memberB.id);
      expect(res.status).toBe(403);
    });

    it('the SAME ASSISTANT is allowed issuing a branch-A copy', async () => {
      const copyA = await seedCopy(org.orgId, org.branchAId, title.id, `DESK-ALLOW-${Date.now()}`);
      const res = await issueAs(org.scopedAssistantToken, copyA.accessionNumber, memberA.id);
      expect(res.status).toBe(201);
      expect(res.body.issue.branchId).toBe(org.branchAId);
    });

    it('is denied returning a branch-B issue', async () => {
      const copyB = await seedCopy(org.orgId, org.branchBId, title.id, `DESK-RET-DENY-${Date.now()}`);
      const issueRes = await issueAs(org.allBranchesLibrarianToken, copyB.accessionNumber, memberB.id);
      expect(issueRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post('/circulation/return')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.scopedAssistantToken}`)
        .send({ accessionNumber: copyB.accessionNumber });
      expect(res.status).toBe(403);
    });

    it('is allowed returning a branch-A issue', async () => {
      const copyA = await seedCopy(org.orgId, org.branchAId, title.id, `DESK-RET-ALLOW-${Date.now()}`);
      const issueRes = await issueAs(org.scopedAssistantToken, copyA.accessionNumber, memberA.id);
      expect(issueRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post('/circulation/return')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.scopedAssistantToken}`)
        .send({ accessionNumber: copyA.accessionNumber });
      expect(res.status).toBe(201);
    });

    it('is denied renewing a branch-B issue', async () => {
      const copyB = await seedCopy(org.orgId, org.branchBId, title.id, `DESK-RENEW-DENY-${Date.now()}`);
      const issueRes = await issueAs(org.allBranchesLibrarianToken, copyB.accessionNumber, memberB.id);
      expect(issueRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post('/circulation/renew')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.scopedAssistantToken}`)
        .send({ accessionNumber: copyB.accessionNumber });
      expect(res.status).toBe(403);
    });

    it('a LIBRARIAN with an empty branches array can issue AND return either branch', async () => {
      const copyB = await seedCopy(org.orgId, org.branchBId, title.id, `DESK-ALLALL-${Date.now()}`);
      const issueRes = await issueAs(org.allBranchesLibrarianToken, copyB.accessionNumber, memberB.id);
      expect(issueRes.status).toBe(201);
      const returnRes = await request(app.getHttpServer())
        .post('/circulation/return')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.allBranchesLibrarianToken}`)
        .send({ accessionNumber: copyB.accessionNumber });
      expect(returnRes.status).toBe(201);
    });
  });

  describe('/circulation/overdue and /circulation/day-report — filtered by staff branch', () => {
    let org: BranchScopeOrg;
    let memberA: { id: string };
    let memberB: { id: string };

    beforeAll(async () => {
      org = await seedOrg(`reports-${Date.now().toString(36)}`);
      memberA = await seedMember(org.orgId, org.branchAId, `REP-A-${Date.now()}`);
      memberB = await seedMember(org.orgId, org.branchBId, `REP-B-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'reports');
      const prisma = getLibraryPlatformPrisma();
      const copyA = await seedCopy(org.orgId, org.branchAId, title.id, `REP-A-${Date.now()}`);
      const copyB = await seedCopy(org.orgId, org.branchBId, title.id, `REP-B-${Date.now()}`);

      // issuedAt defaults to now() -- today's day-report picks both up
      // unless filtered by branch; dueAt is backdated so both are OVERDUE.
      const pastDue = new Date(Date.now() - 3 * MS_PER_DAY);
      await prisma.issue.create({ data: { orgId: org.orgId, copyId: copyA.id, branchId: org.branchAId, memberId: memberA.id, dueAt: pastDue } });
      await prisma.issue.create({ data: { orgId: org.orgId, copyId: copyB.id, branchId: org.branchBId, memberId: memberB.id, dueAt: pastDue } });
    });
    afterAll(() => cleanup(org.orgId));

    it('/overdue for a branch-A librarian excludes branch-B issues', async () => {
      const res = await request(app.getHttpServer())
        .get('/circulation/overdue')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.scopedLibrarianToken}`);
      expect(res.status).toBe(200);
      const memberIds = res.body.map((r: { memberId: string }) => r.memberId);
      expect(memberIds).toContain(memberA.id);
      expect(memberIds).not.toContain(memberB.id);
    });

    it('/overdue for a librarian with an empty branches array includes both branches', async () => {
      const res = await request(app.getHttpServer())
        .get('/circulation/overdue')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.allBranchesLibrarianToken}`);
      expect(res.status).toBe(200);
      const memberIds = res.body.map((r: { memberId: string }) => r.memberId);
      expect(memberIds).toContain(memberA.id);
      expect(memberIds).toContain(memberB.id);
    });

    it('/day-report "issued" for a branch-A librarian excludes the branch-B issue', async () => {
      const scoped = await request(app.getHttpServer())
        .get('/circulation/day-report')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.scopedLibrarianToken}`);
      const allBranches = await request(app.getHttpServer())
        .get('/circulation/day-report')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.allBranchesLibrarianToken}`);

      expect(scoped.status).toBe(200);
      expect(allBranches.status).toBe(200);
      expect(scoped.body.issued).toBe(1);
      expect(scoped.body.overdue).toBe(1);
      expect(allBranches.body.issued).toBe(2);
      expect(allBranches.body.overdue).toBe(2);
    });
  });

  describe('/circulation/reservations — a PENDING (unassigned) reservation passes through; a promoted one is branch-filtered', () => {
    let org: BranchScopeOrg;
    let memberA: { id: string };
    let memberB: { id: string };
    let title: { id: string };
    let pendingHoldId: string;
    let branchBHoldId: string;

    beforeAll(async () => {
      org = await seedOrg(`reservations-${Date.now().toString(36)}`);
      memberA = await seedMember(org.orgId, org.branchAId, `HOLD-A-${Date.now()}`);
      memberB = await seedMember(org.orgId, org.branchBId, `HOLD-B-${Date.now()}`);
      title = await seedTitle(org.orgId, 'reservations');
      const prisma = getLibraryPlatformPrisma();

      // A reservation promoted onto a branch-B copy: issue+return a branch-B copy
      // with a waiter queued FIRST (lowest queuePosition — a return always
      // promotes the OLDEST PENDING reservation on the title, per
      // `nextReservationToPromote`), so the return promotes THIS reservation onto that
      // branch-B copy (branchId = branchB), not whichever reservation is created
      // second.
      const copyB1 = await seedCopy(org.orgId, org.branchBId, title.id, `HOLDS-B1-${Date.now()}`);
      const borrowerB = await seedMember(org.orgId, org.branchBId, `HOLD-BORROW-${Date.now()}`);
      await prisma.issue.create({ data: { orgId: org.orgId, copyId: copyB1.id, branchId: org.branchBId, memberId: borrowerB.id, dueAt: new Date(Date.now() + 14 * MS_PER_DAY) } });
      await prisma.copy.update({ where: { id: copyB1.id }, data: { status: 'ISSUED' } });

      const waiterHoldRes = await request(app.getHttpServer())
        .post('/circulation/reservations')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.allBranchesLibrarianToken}`)
        .send({ titleId: title.id, memberId: memberB.id });
      branchBHoldId = waiterHoldRes.body.reservation.id;

      const returnRes = await request(app.getHttpServer())
        .post('/circulation/return')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.allBranchesLibrarianToken}`)
        .send({ accessionNumber: copyB1.accessionNumber });
      expect(returnRes.body.promotedReservationId).toBe(branchBHoldId);

      // A still-PENDING reservation, created AFTER the one above so it reservations a
      // higher queue position and is NOT the one a return would promote: no
      // branch assigned yet (see the Reservation model's own schema doc).
      const pendingRes = await request(app.getHttpServer())
        .post('/circulation/reservations')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.allBranchesLibrarianToken}`)
        .send({ titleId: title.id, memberId: memberA.id });
      pendingHoldId = pendingRes.body.reservation.id;
    });
    afterAll(() => cleanup(org.orgId));

    it('a branch-A-scoped librarian still sees the still-PENDING (unassigned) reservation', async () => {
      const res = await request(app.getHttpServer())
        .get('/circulation/reservations')
        .query({ titleId: title.id })
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.scopedLibrarianToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((h: { id: string }) => h.id);
      expect(ids).toContain(pendingHoldId);
    });

    it('the SAME branch-A-scoped librarian does NOT see the reservation promoted onto a branch-B copy', async () => {
      const res = await request(app.getHttpServer())
        .get('/circulation/reservations')
        .query({ titleId: title.id })
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.scopedLibrarianToken}`);
      const ids = res.body.map((h: { id: string }) => h.id);
      expect(ids).not.toContain(branchBHoldId);
    });

    it('a librarian with an empty branches array sees both', async () => {
      const res = await request(app.getHttpServer())
        .get('/circulation/reservations')
        .query({ titleId: title.id })
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.allBranchesLibrarianToken}`);
      const ids = res.body.map((h: { id: string }) => h.id);
      expect(ids).toContain(pendingHoldId);
      expect(ids).toContain(branchBHoldId);
    });
  });

  describe('/circulation/fines — filtered via the fine\'s own issue branch', () => {
    let org: BranchScopeOrg;
    let memberA: { id: string };
    let memberB: { id: string };
    let fineAId: string;
    let fineBId: string;

    beforeAll(async () => {
      org = await seedOrg(`fines-${Date.now().toString(36)}`);
      memberA = await seedMember(org.orgId, org.branchAId, `FINE-A-${Date.now()}`);
      memberB = await seedMember(org.orgId, org.branchBId, `FINE-B-${Date.now()}`);
      const title = await seedTitle(org.orgId, 'fines');
      const prisma = getLibraryPlatformPrisma();
      const copyA = await seedCopy(org.orgId, org.branchAId, title.id, `FINE-A-${Date.now()}`);
      const copyB = await seedCopy(org.orgId, org.branchBId, title.id, `FINE-B-${Date.now()}`);

      const loanA = await prisma.issue.create({ data: { orgId: org.orgId, copyId: copyA.id, branchId: org.branchAId, memberId: memberA.id, dueAt: new Date(Date.now() - MS_PER_DAY) } });
      const loanB = await prisma.issue.create({ data: { orgId: org.orgId, copyId: copyB.id, branchId: org.branchBId, memberId: memberB.id, dueAt: new Date(Date.now() - MS_PER_DAY) } });
      const fineA = await prisma.fine.create({ data: { orgId: org.orgId, memberId: memberA.id, issueId: loanA.id, kind: 'OVERDUE', status: 'OPEN', amount: 10 } });
      const fineB = await prisma.fine.create({ data: { orgId: org.orgId, memberId: memberB.id, issueId: loanB.id, kind: 'OVERDUE', status: 'OPEN', amount: 10 } });
      fineAId = fineA.id;
      fineBId = fineB.id;
    });
    afterAll(() => cleanup(org.orgId));

    it('a branch-A-scoped librarian sees the branch-A fine but not the branch-B fine', async () => {
      const res = await request(app.getHttpServer())
        .get('/circulation/fines')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.scopedLibrarianToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((f: { id: string }) => f.id);
      expect(ids).toContain(fineAId);
      expect(ids).not.toContain(fineBId);
    });

    it('a librarian with an empty branches array sees both fines', async () => {
      const res = await request(app.getHttpServer())
        .get('/circulation/fines')
        .set('X-Library-Host', host(org))
        .set('Authorization', `Bearer ${org.allBranchesLibrarianToken}`);
      const ids = res.body.map((f: { id: string }) => f.id);
      expect(ids).toContain(fineAId);
      expect(ids).toContain(fineBId);
    });
  });
});
