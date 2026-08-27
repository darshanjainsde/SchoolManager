import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { seedMinimalSchool, signSchoolToken } from './integration/helpers';
import { AlumniAuthService } from '../src/modules/alumni/internal/alumni-auth.service';

/**
 * The alumnus-facing boundary, over HTTP.
 *
 * Three tiers, and the test's job is to prove the lines BETWEEN them rather
 * than that each works:
 *
 *   public         — batch pages and claim redemption, no token at all
 *   verified       — a session, so directory and giving
 *   trusted        — additionally cleared to be in a room with children
 *
 * The interesting assertions are all negative: a verified alumnus must not
 * reach the trusted tier, a session must not reach the office, and a school
 * admin's JWT must not be accepted as an alumni session (they are different
 * credentials for different people and the routes must not confuse them).
 */
describe('Alumni portal authorization', () => {
  let app: INestApplication;
  const auth = new AlumniAuthService();
  let schoolId: string;
  let host: string;
  let adminToken: string;
  /** Verified, but NOT cleared to work with students. */
  let plainSession: string;
  /** Verified AND trusted. */
  let trustedSession: string;
  let plainId: string;

  const PUBLIC_ROUTES = [
    { method: 'get' as const, path: '/alumni/batches' },
    { method: 'get' as const, path: '/alumni/batches/2004' },
  ];

  /** Needs a session. */
  const MEMBER_ROUTES = [
    { method: 'get' as const, path: '/alumni/me' },
    { method: 'put' as const, path: '/alumni/me', body: { city: 'Pune' } },
    { method: 'post' as const, path: '/alumni/me/sign-out' },
    { method: 'get' as const, path: '/alumni/me/directory' },
    { method: 'get' as const, path: '/alumni/me/gift-groups' },
    { method: 'get' as const, path: '/alumni/me/gift-items' },
    { method: 'get' as const, path: '/alumni/me/pledges' },
    { method: 'post' as const, path: '/alumni/me/pledges', body: { scopeKind: 'SCHOOL', mode: 'SUPPLY', customRequest: 'Sweaters' } },
  ];

  /** Needs a session AND trustedForStudents. */
  const TRUSTED_ROUTES = [
    { method: 'get' as const, path: '/alumni/me/sessions' },
    { method: 'get' as const, path: '/alumni/me/sessions/slots?classSectionId=00000000-0000-4000-8000-000000000001&from=2026-11-11&to=2026-11-11' },
    { method: 'post' as const, path: '/alumni/me/sessions', body: { title: 'Bridges', classSectionId: '00000000-0000-4000-8000-000000000001', date: '2026-11-11', periodId: '00000000-0000-4000-8000-000000000001' } },
    { method: 'post' as const, path: '/alumni/me/sessions/00000000-0000-4000-8000-000000000001/decide', body: { action: 'CANCEL' } },
  ];

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    schoolId = seeded.schoolId;
    host = seeded.host;
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });

    const db = getPlatformPrisma();
    await db.featureOverride.create({ data: { schoolId, featureKey: 'ALUMNI', enabled: true } });

    const plain = await db.alumni.create({
      data: { schoolId, firstName: 'Plain', lastName: 'Alum', batchYear: 2004, status: 'VERIFIED' },
    });
    plainId = plain.id;
    const trusted = await db.alumni.create({
      data: {
        schoolId, firstName: 'Trusted', lastName: 'Speaker', batchYear: 2004,
        status: 'VERIFIED', trustedForStudents: true,
      },
    });
    // One active student, so a SCHOOL-scope pledge resolves a real headcount
    // instead of bouncing on EMPTY_GROUP — otherwise the attribution assertion
    // below would be testing the wrong refusal.
    await db.student.create({
      data: { schoolId, admissionNo: 'P-1', firstName: 'One', lastName: 'Child' },
    });

    plainSession = (await auth.redeemClaim(schoolId, (await auth.mintClaimToken(schoolId, plain.id)).token)).session;
    trustedSession = (await auth.redeemClaim(schoolId, (await auth.mintClaimToken(schoolId, trusted.id)).token)).session;

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const srv = () => app.getHttpServer();
  // Functions, not constants: a constant here is evaluated when the describe
  // body runs, which is BEFORE beforeAll assigns `host`.
  const hostOnly = () => ({ 'X-Skoolos-Host': host });
  const withSession = (s: string) => ({ ...hostOnly(), Authorization: `Bearer ${s}` });

  const call = (
    r: { method: 'get' | 'post' | 'put'; path: string; body?: object },
    headers: Record<string, string>,
  ) => {
    const req = request(srv())[r.method](r.path).set(headers);
    return r.body ? req.send(r.body) : req;
  };

  describe('the public tier', () => {
    it.each(PUBLIC_ROUTES)('$path is readable with no token at all', async (r) => {
      // Deliberate. A password wall means a search engine cannot index
      // "Class of 1998", and the alumnus in Dubai never finds himself. The
      // public front IS the recovery engine.
      await call(r, hostOnly()).expect(200);
    });

    it('a batch page never carries a contact detail', async () => {
      const db = getPlatformPrisma();
      await db.alumni.create({
        data: {
          schoolId, firstName: 'Has', lastName: 'Phone', batchYear: 2004, status: 'VERIFIED',
          phone: '+919999999999', email: 'leak@x.test',
          // Even opened to ALUMNI, it must not reach the public page.
          privacy: { name: 'PUBLIC', phone: 'ALUMNI' },
        },
      });
      const res = await request(srv()).get('/alumni/batches/2004').set(hostOnly()).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/919999999999/);
      expect(JSON.stringify(res.body)).not.toMatch(/leak@x.test/);
    });

    it('rejects an absurd year without touching the database', async () => {
      const res = await request(srv()).get('/alumni/batches/99999').set(hostOnly());
      expect(res.status).toBe(200);
      expect(res.body.alumni).toEqual([]);
    });

    it('a non-numeric year is a 400, not a crash', async () => {
      await request(srv()).get('/alumni/batches/nineteen').set(hostOnly()).expect(400);
    });
  });

  describe('self-registration — the public front door to the queue', () => {
    const claim = (over: Record<string, unknown> = {}) => ({
      firstName: 'Rahul', lastName: 'Gupta', batchYear: 1998,
      email: 'rahul@example.test', proof: 'Class teacher was Mrs Sharma', ...over,
    });

    it('accepts a claim from a complete stranger', async () => {
      const res = await request(srv()).post('/alumni/claims').set(hostOnly()).send(claim()).expect(201);
      expect(res.body.received).toBe(true);
    });

    it('creates an INERT row — pending, and visible to nobody', async () => {
      await request(srv()).post('/alumni/claims').set(hostOnly()).send(claim({ firstName: 'Inert' })).expect(201);
      const row = await getPlatformPrisma().alumniClaim.findFirst({
        where: { schoolId, firstName: 'Inert' },
      });
      expect(row!.status).toBe('PENDING');

      // Not in the directory, not on the batch page. A claim is not a person
      // until a human matches it against the register.
      const pub = await request(srv()).get('/alumni/batches/1998').set(hostOnly()).expect(200);
      expect(JSON.stringify(pub.body)).not.toMatch(/Inert/);
      const dir = await request(srv()).get('/alumni/me/directory').set(withSession(plainSession)).expect(200);
      expect(JSON.stringify(dir.body)).not.toMatch(/Inert/);
    });

    it('cannot set its own status, however hard it tries', async () => {
      // forbidNonWhitelisted: a field the DTO does not declare is a 400, not a
      // silent no-op. Without that the verification ladder is decorative.
      await request(srv()).post('/alumni/claims').set(hostOnly())
        .send(claim({ status: 'VERIFIED' })).expect(400);
      await request(srv()).post('/alumni/claims').set(hostOnly())
        .send(claim({ matchedAlumniId: '00000000-0000-4000-8000-000000000001' })).expect(400);
    });

    it('refuses a claim with no way to reply to it', async () => {
      const res = await request(srv()).post('/alumni/claims').set(hostOnly())
        .send(claim({ email: undefined, phone: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CONTACT_REQUIRED');
    });

    it('swallows a duplicate instead of stacking the queue', async () => {
      const dup = claim({ firstName: 'Twice', lastName: 'Over', batchYear: 1992 });
      await request(srv()).post('/alumni/claims').set(hostOnly()).send(dup).expect(201);
      // Same person submitting again because nothing visibly happened is the
      // NORMAL case — there is no status page. Two rows is a queue the
      // coordinator de-duplicates by hand.
      await request(srv()).post('/alumni/claims').set(hostOnly()).send(dup).expect(201);
      const n = await getPlatformPrisma().alumniClaim.count({
        where: { schoolId, firstName: 'Twice', batchYear: 1992 },
      });
      expect(n).toBe(1);
    });

    it('matches a duplicate case-insensitively', async () => {
      const base = claim({ firstName: 'Case', lastName: 'Fold', batchYear: 1991 });
      await request(srv()).post('/alumni/claims').set(hostOnly()).send(base).expect(201);
      await request(srv()).post('/alumni/claims').set(hostOnly())
        .send({ ...base, firstName: 'CASE', lastName: 'fold' }).expect(201);
      const n = await getPlatformPrisma().alumniClaim.count({
        where: { schoolId, batchYear: 1991 },
      });
      expect(n).toBe(1);
    });

    it('enforces field bounds rather than storing whatever arrives', async () => {
      await request(srv()).post('/alumni/claims').set(hostOnly())
        .send(claim({ batchYear: 20260 })).expect(400);
      await request(srv()).post('/alumni/claims').set(hostOnly())
        .send(claim({ proof: 'x' })).expect(400);
      await request(srv()).post('/alumni/claims').set(hostOnly())
        .send(claim({ firstName: 'z'.repeat(200) })).expect(400);
      await request(srv()).post('/alumni/claims').set(hostOnly())
        .send(claim({ email: 'not-an-email' })).expect(400);
    });

    it('is refused entirely for a school without the ALUMNI feature', async () => {
      const plainSchool = await seedMinimalSchool();
      await request(srv()).post('/alumni/claims')
        .set({ 'X-Skoolos-Host': plainSchool.host }).send(claim()).expect(403);
    });

    it('the office can see it and verify it, and only then does the person exist', async () => {
      await request(srv()).post('/alumni/claims').set(hostOnly())
        .send(claim({ firstName: 'Becomes', lastName: 'Real', batchYear: 1987 })).expect(201);

      const queue = await request(srv()).get('/manage/alumni/claims?status=PENDING')
        .set({ ...hostOnly(), Authorization: `Bearer ${adminToken}` }).expect(200);
      const mine = queue.body.find((c: { firstName: string }) => c.firstName === 'Becomes');
      expect(mine).toBeDefined();

      await request(srv()).post(`/manage/alumni/claims/${mine.id}/decide`)
        .set({ ...hostOnly(), Authorization: `Bearer ${adminToken}` })
        .send({ action: 'VERIFY' }).expect(201);

      const alum = await getPlatformPrisma().alumni.findFirst({
        where: { schoolId, firstName: 'Becomes' },
      });
      expect(alum!.status).toBe('VERIFIED');
      // And still NOT cleared to work with students — that is a second,
      // separate decision the school makes by hand.
      expect(alum!.trustedForStudents).toBe(false);
    });
  });

  describe('the member tier', () => {
    it.each(MEMBER_ROUTES)('$method $path refuses an anonymous caller', async (r) => {
      await call(r, hostOnly()).expect(401);
    });

    it.each(MEMBER_ROUTES)('$method $path refuses a forged session', async (r) => {
      await call(r, withSession('z'.repeat(43))).expect(401);
    });

    it('refuses a SCHOOL_ADMIN JWT presented as an alumni session', async () => {
      // Different credential, different person. A JWT that happens to be a
      // bearer token must not be mistaken for a session token.
      await request(srv())
        .get('/alumni/me')
        .set({ ...hostOnly(), Authorization: `Bearer ${adminToken}` })
        .expect(401);
    });

    it('accepts a real session', async () => {
      const res = await request(srv()).get('/alumni/me').set(withSession(plainSession)).expect(200);
      expect(res.body.id).toBe(plainId);
    });

    it('an alumni session cannot reach the OFFICE routes', async () => {
      // The two doors are separate all the way down: a session is not a JWT and
      // carries no role, so RolesGuard refuses it.
      const res = await request(srv()).get('/manage/alumni/summary').set(withSession(plainSession));
      expect([401, 403]).toContain(res.status);
    });

    it('an alumnus cannot promote themselves', async () => {
      // UpdateMeDto has no status / trustedForStudents / isBatchCaptain field,
      // and forbidNonWhitelisted turns sending one into a 400 rather than a
      // silent no-op. Without that the verification ladder is decorative.
      const res = await request(srv())
        .put('/alumni/me')
        .set(withSession(plainSession))
        .send({ trustedForStudents: true, status: 'VERIFIED' });
      expect(res.status).toBe(400);

      const after = await getPlatformPrisma().alumni.findUnique({ where: { id: plainId } });
      expect(after!.trustedForStudents).toBe(false);
    });

    it('a pledge is attributed to the SESSION, not to whatever the body claims', async () => {
      const db = getPlatformPrisma();
      const someoneElse = await db.alumni.create({
        data: { schoolId, firstName: 'Some', lastName: 'One', batchYear: 1999, status: 'VERIFIED' },
      });
      // `alumniId` IS a legal field on the DTO — the office route needs it to
      // record a gift offered over the counter — so the pipe does not reject
      // it. The controller overwrites it from the session instead, and that is
      // the property worth asserting: not that the request is refused, but that
      // the row lands on the right person. Otherwise anybody could pledge in
      // somebody else's name, with a dedication attached to it.
      const res = await request(srv())
        .post('/alumni/me/pledges')
        .set(withSession(plainSession))
        .send({ scopeKind: 'SCHOOL', mode: 'SUPPLY', customRequest: 'Sweaters', alumniId: someoneElse.id })
        .expect(201);
      expect(res.body.alumniId).toBe(plainId);
      expect(res.body.alumniId).not.toBe(someoneElse.id);
      // And the donor-name fields are blanked, so a member pledge can never be
      // dressed up as somebody walking in off the street.
      expect(res.body.donorName).toBeNull();
    });
  });

  describe('the trusted tier', () => {
    it.each(TRUSTED_ROUTES)('$method $path refuses an anonymous caller', async (r) => {
      await call(r, hostOnly()).expect(401);
    });

    it.each(TRUSTED_ROUTES)('$method $path refuses a VERIFIED but untrusted alumnus', async (r) => {
      // The line that matters most in the whole module. Being a real alumnus
      // gets you the directory; it does not get you a room full of
      // fourteen-year-olds.
      await call(r, withSession(plainSession)).expect(403);
    });

    it.each(TRUSTED_ROUTES)('$method $path lets a TRUSTED alumnus through the guard', async (r) => {
      const res = await call(r, withSession(trustedSession));
      expect([401, 403]).not.toContain(res.status);
    });

    it('withdrawing trust closes the door on the NEXT request, not in ninety days', async () => {
      const db = getPlatformPrisma();
      const t = await db.alumni.findFirst({ where: { schoolId, firstName: 'Trusted' } });
      await db.alumni.update({ where: { id: t!.id }, data: { trustedForStudents: false } });
      try {
        await request(srv()).get('/alumni/me/sessions').set(withSession(trustedSession)).expect(403);
      } finally {
        await db.alumni.update({ where: { id: t!.id }, data: { trustedForStudents: true } });
      }
    });

    it('un-verifying invalidates the session entirely', async () => {
      const db = getPlatformPrisma();
      const t = await db.alumni.findFirst({ where: { schoolId, firstName: 'Trusted' } });
      await db.alumni.update({ where: { id: t!.id }, data: { status: 'PENDING' } });
      try {
        await request(srv()).get('/alumni/me').set(withSession(trustedSession)).expect(401);
      } finally {
        await db.alumni.update({ where: { id: t!.id }, data: { status: 'VERIFIED' } });
      }
    });
  });

  describe('the feature gate covers the alumnus side too', () => {
    it('refuses public and member routes alike for a school without ALUMNI', async () => {
      const plainSchool = await seedMinimalSchool();
      for (const r of [...PUBLIC_ROUTES, ...MEMBER_ROUTES, ...TRUSTED_ROUTES]) {
        const res = await call(r, { 'X-Skoolos-Host': plainSchool.host });
        expect({ route: r.path, status: res.status }).toEqual({ route: r.path, status: 403 });
      }
    });
  });

  describe('the office route that mints a link', () => {
    it('refuses an alumni session', async () => {
      const res = await request(srv())
        .post(`/manage/alumni/${plainId}/claim-link`)
        .set(withSession(plainSession));
      expect([401, 403]).toContain(res.status);
    });

    it('lets the office mint one, and returns the raw token exactly once', async () => {
      const res = await request(srv())
        .post(`/manage/alumni/${plainId}/claim-link`)
        .set({ ...hostOnly(), Authorization: `Bearer ${adminToken}` })
        .expect(201);
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token.length).toBeGreaterThan(30);
    });
  });
});
