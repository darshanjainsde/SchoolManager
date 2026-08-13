import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { getLibraryPlatformPrisma } from '@library/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { signAccessToken } from '../src/modules/auth/internal/auth.module';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Review finding 2 (catalogue, Important): BranchScopeGuard only looked at
 * `req.params`/`req.query`, but every catalogue route that carries a
 * `branchId` at all puts it in the BODY (`AddCopyDto.branchId`), and
 * `PATCH /catalog/copies/:id` / `GET /catalog/copies/by-accessionNumber/:accessionNumber`
 * carry no `branchId` anywhere in the request — the branch is a property of
 * the existing Copy row. So `requested` was always `undefined` and the guard
 * always returned `true`: a LIBRARIAN scoped to one branch could add/update
 * copies for any branch in the org (an intra-tenant scoping gap — RLS still
 * held the org boundary, this never crossed tenants).
 *
 * Run end-to-end (real app, real HTTP, real JWTs) rather than unit-testing
 * the guard/service in isolation, because the defect was specifically about
 * how the guard and the two branch-less routes behave wired together in the
 * real request pipeline — that is exactly the kind of thing a
 * guard-in-isolation test proved green while the endpoint stayed open.
 */
describeLive('catalogue — branch scope is enforced on all four copy routes', () => {
  let app: INestApplication;
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let branchB: { id: string };
  let titleA: { id: string };
  let scopedToken: string; // LIBRARIAN, branches: [orgA.branchId] only
  let allBranchesToken: string; // LIBRARIAN, branches: [] (all branches)
  const host = (o: SeededOrg) => `${o.slug}.library.trackyour.in`;

  beforeAll(async () => {
    process.env.DISABLE_THROTTLER = 'true';

    ({ orgA, orgB } = await seedTwoOrgs(`catbranch-${Date.now().toString(36)}`));
    const prisma = getLibraryPlatformPrisma();

    // A second branch WITHIN orgA — this is an intra-tenant scoping gap, not
    // a cross-org one, so both branches belong to the same org.
    branchB = await prisma.branch.create({ data: { orgId: orgA.id, name: 'Branch B', code: 'BR-B' } });
    titleA = await prisma.title.create({ data: { orgId: orgA.id, title: 'Branch Scope Probe Title' } });

    const passwordHash = await argon2.hash('branch-scope-e2e-Pw1!', { type: argon2.argon2id });
    const suffix = Date.now().toString(36);
    const scopedUser = await prisma.libUser.create({
      data: {
        orgId: orgA.id,
        email: `scoped-librarian-${suffix}@branchscope.test`,
        passwordHash,
        role: 'LIBRARIAN',
        branchIds: [orgA.branchId],
        active: true,
      },
    });
    const allBranchesUser = await prisma.libUser.create({
      data: {
        orgId: orgA.id,
        email: `all-branch-librarian-${suffix}@branchscope.test`,
        passwordHash,
        role: 'LIBRARIAN',
        branchIds: [],
        active: true,
      },
    });

    const jwt = new JwtService(); // same standalone pattern as test/helpers/live-db.ts's seedLogins
    scopedToken = signAccessToken(jwt, {
      id: scopedUser.id, orgId: scopedUser.orgId, role: scopedUser.role, branchIds: scopedUser.branchIds,
    });
    allBranchesToken = signAccessToken(jwt, {
      id: allBranchesUser.id, orgId: allBranchesUser.orgId, role: allBranchesUser.role,
      branchIds: allBranchesUser.branchIds,
    });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    delete process.env.DISABLE_THROTTLER;
    await app?.close();
    await closeOrgLookupRedis();
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  const addCopy = (token: string, branchId: string, accessionNumber: string) =>
    request(app.getHttpServer())
      .post(`/catalog/titles/${titleA.id}/copies`)
      .set('X-Library-Host', host(orgA))
      .set('Authorization', `Bearer ${token}`)
      .send({ branchId, accessionNumber });

  it('denies a librarian scoped to branch A adding a copy to branch B (body branchId)', async () => {
    const res = await addCopy(scopedToken, branchB.id, `BRANCH-SCOPE-DENY-${Date.now()}`);
    expect(res.status).toBe(403);
  });

  it('allows a librarian scoped to branch A adding a copy to branch A', async () => {
    const res = await addCopy(scopedToken, orgA.branchId, `BRANCH-SCOPE-ALLOW-${Date.now()}`);
    expect(res.status).toBeLessThan(400);
    expect(res.body.branchId).toBe(orgA.branchId);
  });

  it('allows a librarian with an empty branches array to add a copy to any branch', async () => {
    const res = await addCopy(allBranchesToken, branchB.id, `BRANCH-SCOPE-ALL-${Date.now()}`);
    expect(res.status).toBeLessThan(400);
    expect(res.body.branchId).toBe(branchB.id);
  });

  describe('routes that carry no branchId in the request at all', () => {
    let copyInBranchA: { id: string; accessionNumber: string };
    let copyInBranchB: { id: string; accessionNumber: string };

    beforeAll(async () => {
      const createdA = await addCopy(allBranchesToken, orgA.branchId, `BRANCH-SCOPE-FIXTURE-A-${Date.now()}`);
      const createdB = await addCopy(allBranchesToken, branchB.id, `BRANCH-SCOPE-FIXTURE-B-${Date.now()}`);
      copyInBranchA = { id: createdA.body.id, accessionNumber: createdA.body.accessionNumber };
      copyInBranchB = { id: createdB.body.id, accessionNumber: createdB.body.accessionNumber };
    });

    it('denies a librarian scoped to branch A updating a copy that lives in branch B', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/catalog/copies/${copyInBranchB.id}`)
        .set('X-Library-Host', host(orgA))
        .set('Authorization', `Bearer ${scopedToken}`)
        .send({ shelf: 'Hacked' });
      expect(res.status).toBe(403);
    });

    it('allows a librarian scoped to branch A updating a copy that lives in branch A', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/catalog/copies/${copyInBranchA.id}`)
        .set('X-Library-Host', host(orgA))
        .set('Authorization', `Bearer ${scopedToken}`)
        .send({ shelf: 'A1' });
      expect(res.status).toBeLessThan(400);
      expect(res.body.shelf).toBe('A1');
    });

    it('allows a librarian with an empty branches array to update a copy in any branch', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/catalog/copies/${copyInBranchB.id}`)
        .set('X-Library-Host', host(orgA))
        .set('Authorization', `Bearer ${allBranchesToken}`)
        .send({ shelf: 'B1' });
      expect(res.status).toBeLessThan(400);
      expect(res.body.shelf).toBe('B1');
    });

    it('denies a librarian scoped to branch A reading a branch-B copy by accessionNumber', async () => {
      const res = await request(app.getHttpServer())
        .get(`/catalog/copies/by-accessionNumber/${copyInBranchB.accessionNumber}`)
        .set('X-Library-Host', host(orgA))
        .set('Authorization', `Bearer ${scopedToken}`);
      expect(res.status).toBe(403);
    });

    it('allows a librarian scoped to branch A reading a branch-A copy by accessionNumber', async () => {
      const res = await request(app.getHttpServer())
        .get(`/catalog/copies/by-accessionNumber/${copyInBranchA.accessionNumber}`)
        .set('X-Library-Host', host(orgA))
        .set('Authorization', `Bearer ${scopedToken}`);
      expect(res.status).toBeLessThan(400);
      expect(res.body.id).toBe(copyInBranchA.id);
    });
  });
});
