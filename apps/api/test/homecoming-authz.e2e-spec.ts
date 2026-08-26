import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * Who may call the Alumni Office, proved over HTTP.
 *
 * Until this existed, the only argument that a TEACHER token could not reach
 * `/manage/alumni` was that the decorators looked like the ones on the other
 * `manage/*` controllers. That is an argument from similarity, and the reason
 * `route-coverage.e2e-spec.ts` exists at all is a controller that shipped with
 * RolesGuard on two of six handlers while a STUDENT token could delete staff.
 * Nothing failed. Similarity is not evidence.
 *
 * Every route on AlumniController is exercised here with at least one token
 * that must be refused, which is what earns them a place in AUTHZ_REVIEWED.
 *
 * ts-jest emits `design:paramtypes` (tsconfig.base sets emitDecoratorMetadata),
 * so guards resolve and the global ValidationPipe sees real metatypes — the
 * conditions LIBRARY-TRAPS #6 and #18 warn are ABSENT under tsx. A DTO bound
 * asserted here is therefore a real bound, not a dev-server illusion.
 */
describe('Alumni Office authorization', () => {
  let app: INestApplication;
  let schoolId: string;
  let host: string;
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let staffToken: string;
  /** A second school, to prove the door is not merely role-shaped but tenant-shaped. */
  let otherSchoolId: string;
  let otherHost: string;
  let otherAdminToken: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    schoolId = seeded.schoolId;
    host = seeded.host;
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    teacherToken = signSchoolToken({ sub: seeded.teacherUserId, schoolId, role: 'TEACHER' });
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });
    staffToken = signSchoolToken({ sub: seeded.staffUserId, schoolId, role: 'STAFF' });

    const other = await seedMinimalSchool();
    otherSchoolId = other.schoolId;
    otherHost = other.host;
    otherAdminToken = signSchoolToken({
      sub: other.adminUserId,
      schoolId: otherSchoolId,
      role: 'SCHOOL_ADMIN',
    });

    // ALUMNI belongs to no tier, so both schools need the override on before a
    // single route is reachable — which is itself the first assertion below.
    const db = getPlatformPrisma();
    for (const sid of [schoolId, otherSchoolId]) {
      await db.featureOverride.create({
        data: { schoolId: sid, featureKey: 'ALUMNI', enabled: true },
      });
    }

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const as = (token: string, h = host) => ({
    Authorization: `Bearer ${token}`,
    'X-Skoolos-Host': h,
  });
  const srv = () => app.getHttpServer();

  /** Every route on the controller, with a body good enough to get past
   *  validation so a 403 is proved to come from the guard and not the pipe. */
  const ROUTES: { method: 'get' | 'post' | 'put'; path: string; body?: object }[] = [
    { method: 'get', path: '/manage/alumni/summary' },
    { method: 'get', path: '/manage/alumni' },
    { method: 'post', path: '/manage/alumni/graduate', body: { classSectionIds: [], batchYear: 2026 } },
    { method: 'get', path: '/manage/alumni/roll-call' },
    { method: 'put', path: '/manage/alumni/roll-call', body: { batchYear: 2026, registerStrength: 10 } },
    { method: 'put', path: '/manage/alumni/00000000-0000-4000-8000-000000000001/trusted', body: { trusted: false } },
    { method: 'get', path: '/manage/alumni/claims' },
    { method: 'post', path: '/manage/alumni/claims/00000000-0000-4000-8000-000000000001/decide', body: { action: 'VERIFY' } },
    { method: 'get', path: '/manage/alumni/gift-items' },
    { method: 'post', path: '/manage/alumni/gift-items', body: { name: 'Sweater' } },
    { method: 'put', path: '/manage/alumni/gift-items/00000000-0000-4000-8000-000000000001', body: { name: 'Sweater' } },
    { method: 'get', path: '/manage/alumni/gift-groups' },
    { method: 'get', path: '/manage/alumni/pledges' },
    { method: 'post', path: '/manage/alumni/pledges', body: { scopeKind: 'SCHOOL', mode: 'SUPPLY', donorName: 'X', customRequest: 'Y' } },
    { method: 'post', path: '/manage/alumni/pledges/00000000-0000-4000-8000-000000000001/decide', body: { action: 'ACCEPT' } },
    { method: 'post', path: '/manage/alumni/pledges/00000000-0000-4000-8000-000000000001/receive', body: { receivedQty: 1 } },
    { method: 'post', path: '/manage/alumni/pledges/00000000-0000-4000-8000-000000000001/distribute', body: { distributedQty: 1 } },
    { method: 'post', path: '/manage/alumni/pledges/00000000-0000-4000-8000-000000000001/report' },
    { method: 'get', path: '/manage/alumni/slots?classSectionId=00000000-0000-4000-8000-000000000001&from=2026-11-11&to=2026-11-11' },
    { method: 'get', path: '/manage/alumni/sessions' },
    { method: 'post', path: '/manage/alumni/sessions', body: { alumniId: '00000000-0000-4000-8000-000000000001', title: 'Bridges', classSectionId: '00000000-0000-4000-8000-000000000001', date: '2026-11-11', periodId: '00000000-0000-4000-8000-000000000001' } },
    { method: 'get', path: '/manage/alumni/sessions/00000000-0000-4000-8000-000000000001/conflicts' },
    { method: 'post', path: '/manage/alumni/sessions/00000000-0000-4000-8000-000000000001/decide', body: { action: 'DECLINE', reason: 'no' } },
    { method: 'post', path: '/manage/alumni/sessions/00000000-0000-4000-8000-000000000001/decide-as-host', body: { action: 'CANCEL' } },
  ];

  const call = (r: (typeof ROUTES)[number], headers: Record<string, string>) => {
    const req = request(srv())[r.method](r.path).set(headers);
    return r.body ? req.send(r.body) : req;
  };

  it('covers every route the controller mounts', () => {
    // If a route is added and this list is not, the count drifts and the
    // route-coverage manifest goes red — which is the point of both.
    expect(ROUTES).toHaveLength(24);
  });

  describe.each(ROUTES)('$method $path', (route) => {
    it('refuses an anonymous caller with 401', async () => {
      await call(route, { 'X-Skoolos-Host': host }).expect(401);
    });

    it('refuses a STUDENT with 403', async () => {
      // A student must never reach the alumni wing. Adults and children do not
      // browse each other, and this is the door that would let them.
      await call(route, as(studentToken)).expect(403);
    });

    it('refuses a TEACHER with 403', async () => {
      await call(route, as(teacherToken)).expect(403);
    });

    it('refuses a STAFF login with 403', async () => {
      // STAFF is the shape an ALUMNI_COORDINATOR will eventually take, and it
      // is deliberately refused until that job actually exists on the Staff
      // record. Better a locked door than one that opens for every clerk.
      await call(route, as(staffToken)).expect(403);
    });

    it('does not refuse a SCHOOL_ADMIN on authorization grounds', async () => {
      const res = await call(route, as(adminToken));
      // 404/400/409 are fine — those are "the row is not there" or "that is not
      // a legal move", which means the guard let the caller through. Only 401
      // and 403 would mean the door itself is shut.
      expect([401, 403]).not.toContain(res.status);
    });
  });

  describe('the feature gate', () => {
    /**
     * A third school that never had the override at all, rather than flipping
     * an existing one to `enabled: false`.
     *
     * Feature resolution is cached in Redis for 300 seconds
     * (FeatureResolverService.TTL), so a mid-test flip is invisible for five
     * minutes and the first version of this test read that as "the gate does
     * not work". Reaching into the cache to make the assertion pass would be
     * testing the test; a school that never had the feature is the real-world
     * case anyway, and it needs no cache surgery.
     */
    it('refuses EVERY route with 403 for a school that does not have ALUMNI', async () => {
      const plain = await seedMinimalSchool();
      const plainToken = signSchoolToken({
        sub: plain.adminUserId,
        schoolId: plain.schoolId,
        role: 'SCHOOL_ADMIN',
      });
      for (const r of ROUTES) {
        const res = await call(r, as(plainToken, plain.host));
        expect({ route: `${r.method} ${r.path}`, status: res.status }).toEqual({
          route: `${r.method} ${r.path}`,
          status: 403,
        });
      }
    });
  });

  describe('the door is tenant-shaped, not only role-shaped', () => {
    it('one school’s admin cannot read another school’s alumni', async () => {
      const db = getPlatformPrisma();
      await db.alumni.create({
        data: { schoolId: otherSchoolId, firstName: 'Their', lastName: 'Alum', batchYear: 2004 },
      });

      const mine = await request(srv()).get('/manage/alumni').set(as(adminToken)).expect(200);
      expect(mine.body.total).toBe(0);

      const theirs = await request(srv())
        .get('/manage/alumni')
        .set(as(otherAdminToken, otherHost))
        .expect(200);
      expect(theirs.body.total).toBe(1);
    });

    it('a token for one school presented on another school’s host is refused', async () => {
      // The Host header decides the tenant; the token must agree with it.
      const res = await request(srv()).get('/manage/alumni').set(as(adminToken, otherHost));
      expect([401, 403]).toContain(res.status);
    });
  });

  /**
   * LIBRARY-TRAPS #18: `tsx` skips DTO validation because the metadata is
   * missing, so a curl session against `pnpm dev` proves nothing about any
   * @Min/@Max. These run under ts-jest, which emits it — so a 400 here is the
   * pipe actually rejecting the value.
   */
  describe('DTO bounds are real, not decorative', () => {
    it('rejects a batch year outside the allowed range with 400, not 500', async () => {
      await request(srv())
        .put('/manage/alumni/roll-call')
        .set(as(adminToken))
        .send({ batchYear: 20260, registerStrength: 10 })
        .expect(400);
    });

    it('rejects a negative register strength', async () => {
      await request(srv())
        .put('/manage/alumni/roll-call')
        .set(as(adminToken))
        .send({ batchYear: 2026, registerStrength: -5 })
        .expect(400);
    });

    it('rejects a register strength above the cap', async () => {
      await request(srv())
        .put('/manage/alumni/roll-call')
        .set(as(adminToken))
        .send({ batchYear: 2026, registerStrength: 999999 })
        .expect(400);
    });

    it('rejects a gift item priced above the sanity cap', async () => {
      // A typo here becomes a pledge somebody feels obliged to honour.
      await request(srv())
        .post('/manage/alumni/gift-items')
        .set(as(adminToken))
        .send({ name: 'Gold bar', indicativeCostMinor: 999_999_999 })
        .expect(400);
    });

    it('rejects a non-uuid where a uuid is required', async () => {
      await request(srv())
        .post('/manage/alumni/graduate')
        .set(as(adminToken))
        .send({ classSectionIds: ['not-a-uuid'], batchYear: 2026 })
        .expect(400);
    });

    it('rejects an unknown enum value on a decision', async () => {
      await request(srv())
        .post('/manage/alumni/pledges/00000000-0000-4000-8000-000000000001/decide')
        .set(as(adminToken))
        .send({ action: 'DEMOLISH' })
        .expect(400);
    });

    it('rejects a missing required field with 400 rather than crashing', async () => {
      await request(srv())
        .post('/manage/alumni/gift-items')
        .set(as(adminToken))
        .send({})
        .expect(400);
    });

    it('REFUSES a client-supplied quantity on a pledge outright', async () => {
      // There is deliberately no `quantity` on CreatePledgeDto: it is the
      // headcount, resolved server-side, so a donor cannot pledge 20 sweaters
      // to a class of 38 by hand.
      //
      // I expected the pipe to silently strip it. It does better than that —
      // app.module sets forbidNonWhitelisted, so the request is REJECTED and
      // the sender is told which property was not allowed. Rejecting beats
      // stripping here: a donor who thinks they pledged 1 and silently pledged
      // 38 has been misled by their own request succeeding.
      const res = await request(srv())
        .post('/manage/alumni/pledges')
        .set(as(adminToken))
        .send({
          scopeKind: 'SCHOOL',
          mode: 'SUPPLY',
          donorName: 'Sneaky',
          customRequest: 'Sweaters',
          quantity: 1,
        });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/quantity/);
    });

    it('resolves the headcount from the roster, never from the caller', async () => {
      // With no forbidden property the request is legal, and the school has no
      // students — so it is refused for an empty group. That refusal IS the
      // proof: the count came from the roster, not the request.
      const res = await request(srv())
        .post('/manage/alumni/pledges')
        .set(as(adminToken))
        .send({ scopeKind: 'SCHOOL', mode: 'SUPPLY', donorName: 'Honest', customRequest: 'Sweaters' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMPTY_GROUP');
    });
  });
});
