import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * Who may call each Press route.
 *
 * Table-driven so a new endpoint that slips onto the controller without a
 * decision fails `route-coverage.e2e-spec.ts` rather than shipping open. The
 * register is a statutory record and a TC can be issued over unpaid fees —
 * "nobody looked at this route" is not an acceptable state here.
 *
 * PRESS belongs to NO tier (the ALUMNI launch shape), so the seeded school
 * needs the override before a single route is reachable — asserted last.
 */

const UUID = '00000000-0000-0000-0000-000000000001';

/** Every `/manage/press/*` route: office only (SCHOOL_ADMIN + STAFF). */
const OFFICE_ROUTES: [method: 'get' | 'post' | 'put', path: string][] = [
  ['get', '/manage/press/years'],
  ['get', '/manage/press/classes'],
  ['get', '/manage/press/students'],
  ['get', '/manage/press/windows'],
  ['put', '/manage/press/windows'],
  ['get', `/manage/press/report-cards/${UUID}/${UUID}`],
  ['put', '/manage/press/remarks'],
  ['post', '/manage/press/report-cards/issue'],
  ['get', `/manage/press/certificates/prepare/${UUID}`],
  ['post', '/manage/press/certificates/issue'],
  ['get', '/manage/press/register'],
  ['get', `/manage/press/register/${UUID}`],
  ['post', `/manage/press/register/${UUID}/void`],
];

/** Every `/me/report-cards*` route: the signed-in student/parent only. */
const PORTAL_ROUTES: [method: 'get', path: string][] = [
  ['get', '/me/report-cards'],
  ['get', `/me/report-cards/${UUID}`],
];

describe('press authorization', () => {
  let app: INestApplication;
  let host: string;
  let studentToken: string;
  let adminToken: string;
  let staffToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    host = seeded.host;
    const schoolId = seeded.schoolId;
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    staffToken = signSchoolToken({ sub: seeded.staffUserId, schoolId, role: 'STAFF' });
    teacherToken = signSchoolToken({ sub: seeded.teacherUserId, schoolId, role: 'TEACHER' });

    // PRESS is in no tier — even a PRO school needs the override.
    await getPlatformPrisma().featureOverride.create({
      data: { schoolId, featureKey: 'PRESS', enabled: true },
    });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const call = (method: string, path: string, token?: string) => {
    const req = (request(app.getHttpServer()) as unknown as Record<string, (p: string) => request.Test>)[method](path);
    return token
      ? req.set({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': host })
      : req.set({ 'X-Skoolos-Host': host });
  };

  describe.each(OFFICE_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller', async () => {
      await call(method, path).expect(401);
    });

    it('rejects a STUDENT', async () => {
      await call(method, path, studentToken).expect(403);
    });

    it('rejects a TEACHER — issuing documents is front-office work', async () => {
      await call(method, path, teacherToken).expect(403);
    });

    it('lets an admin through the guards', async () => {
      const res = await call(method, path, adminToken);
      expect([401, 403]).not.toContain(res.status);
    });

    it('lets office STAFF through the guards', async () => {
      const res = await call(method, path, staffToken);
      expect([401, 403]).not.toContain(res.status);
    });
  });

  describe.each(PORTAL_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller', async () => {
      await call(method, path).expect(401);
    });

    it('rejects an admin — /me/* is the family’s own record', async () => {
      await call(method, path, adminToken).expect(403);
    });

    it('rejects a TEACHER', async () => {
      await call(method, path, teacherToken).expect(403);
    });

    it('lets the student through the guards', async () => {
      const res = await call(method, path, studentToken);
      expect([401, 403]).not.toContain(res.status);
    });
  });

  it("a family can only open its OWN card — someone else's answers 404, not 403", async () => {
    // The manifest claims the portal routes are the caller's-own-JWT only;
    // this is the assertion that makes the claim true. Student A has an
    // issued card; student B fetching it must get "not found" — whether a
    // card exists is information about somebody else's child.
    const db = getPlatformPrisma();
    const seeded = await seedMinimalSchool();
    await db.featureOverride.create({
      data: { schoolId: seeded.schoolId, featureKey: 'PRESS', enabled: true },
    });
    const studentA = await db.student.findFirstOrThrow({
      where: { schoolId: seeded.schoolId, userId: { not: null } },
      select: { id: true, userId: true },
    });
    const issue = await db.pressIssue.create({
      data: {
        schoolId: seeded.schoolId,
        type: 'REPORT_CARD',
        serial: 'RC/2026/9001',
        studentId: studentA.id,
        payload: { kind: 'REPORT_CARD', windowName: 'Term I' },
        issuedById: seeded.adminUserId,
      },
    });
    const userB = await db.user.create({
      data: { schoolId: seeded.schoolId, email: `b-${Date.now()}@press.test`, role: 'STUDENT', passwordHash: 'x' },
    });
    await db.student.create({
      data: {
        schoolId: seeded.schoolId, admissionNo: `B-${Date.now()}`,
        firstName: 'Other', lastName: 'Child', userId: userB.id,
      },
    });

    const tokenA = signSchoolToken({ sub: studentA.userId!, schoolId: seeded.schoolId, role: 'STUDENT' });
    const tokenB = signSchoolToken({ sub: userB.id, schoolId: seeded.schoolId, role: 'STUDENT' });

    await request(app.getHttpServer())
      .get(`/me/report-cards/${issue.id}`)
      .set({ Authorization: `Bearer ${tokenA}`, 'X-Skoolos-Host': seeded.host })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/me/report-cards/${issue.id}`)
      .set({ Authorization: `Bearer ${tokenB}`, 'X-Skoolos-Host': seeded.host })
      .expect(404);
  });

  it('gates the whole module behind the PRESS override — no tier grants it', async () => {
    // A PRO school WITHOUT the override gets 403 even as an admin: the module
    // must be unreachable everywhere until the owner console turns it on.
    const other = await seedMinimalSchool();
    const token = signSchoolToken({ sub: other.adminUserId, schoolId: other.schoolId, role: 'SCHOOL_ADMIN' });

    await request(app.getHttpServer())
      .get('/manage/press/windows')
      .set({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': other.host })
      .expect(403);
  });
});
