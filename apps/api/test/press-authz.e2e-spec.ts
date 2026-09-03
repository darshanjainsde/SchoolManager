import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signPlatformToken, signSchoolToken, seedMinimalSchool } from './integration/helpers';
import { loadEnv } from '@skoolos/config';

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
  ['get', '/manage/press/overview'],
  ['post', '/manage/press/certificates/bulk'],
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
  // Press Orders — the school's order counter, same front-office wall.
  ['get', '/manage/press/orders'],
  ['get', `/manage/press/orders/${UUID}`],
  ['post', '/manage/press/orders/report-cards'],
  ['post', '/manage/press/orders/upload'],
  ['post', `/manage/press/orders/${UUID}/confirm`],
  ['post', `/manage/press/orders/${UUID}/cancel`],
];

/** Every `/owner/print-orders*` route: owner host + platform JWT, nothing less. */
const OPERATOR_ROUTES: [method: 'get' | 'post', path: string][] = [
  ['get', '/owner/print-orders'],
  ['get', `/owner/print-orders/${UUID}`],
  ['get', `/owner/print-orders/${UUID}/artifact`],
  ['post', `/owner/print-orders/${UUID}/quote`],
  ['post', `/owner/print-orders/${UUID}/decline`],
  ['post', `/owner/print-orders/${UUID}/printing`],
  ['post', `/owner/print-orders/${UUID}/dispatch`],
  ['post', `/owner/print-orders/${UUID}/delivered`],
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
    // seedMinimalSchool mints a STUDENT *user* but no Student row — link one
    // ourselves (found by running the suite: findFirstOrThrow found none).
    const studentA = await db.student.create({
      data: {
        schoolId: seeded.schoolId, admissionNo: `A-${Date.now()}`,
        firstName: 'Own', lastName: 'Child', userId: seeded.studentUserId,
      },
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
    // The order counter sits behind the same key — a separate controller
    // must not mean a separate (forgotten) gate.
    await request(app.getHttpServer())
      .get('/manage/press/orders')
      .set({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': other.host })
      .expect(403);
  });

  describe.each(OPERATOR_ROUTES)('%s %s (operator desk)', (method, path) => {
    const ownerHost = loadEnv().PLATFORM_OWNER_HOST;

    it('rejects an anonymous caller on the owner host', async () => {
      await call(method, path).set({ 'X-Skoolos-Host': ownerHost }).expect(401);
    });

    it("rejects a school ADMIN's token — a tenant credential opens nothing on the platform side", async () => {
      await call(method, path).set({
        Authorization: `Bearer ${adminToken}`, 'X-Skoolos-Host': ownerHost,
      }).expect(401);
    });

    it('rejects a platform token on a SCHOOL host — the desk exists only behind the owner door', async () => {
      await call(method, path).set({
        Authorization: `Bearer ${signPlatformToken()}`, 'X-Skoolos-Host': host,
      }).expect(403);
    });

    it('lets the operator through the guards', async () => {
      const res = await call(method, path).set({
        Authorization: `Bearer ${signPlatformToken()}`, 'X-Skoolos-Host': ownerHost,
      });
      expect([401, 403]).not.toContain(res.status);
    });
  });

  it('walks one order through its whole life: request → quote → confirm → printing → artifact → delivered', async () => {
    const db = getPlatformPrisma();
    const seeded = await seedMinimalSchool();
    await db.featureOverride.create({
      data: { schoolId: seeded.schoolId, featureKey: 'PRESS', enabled: true },
    });
    const year = await db.academicYear.create({
      data: { schoolId: seeded.schoolId, name: '2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') },
    });
    const grade = await db.grade.create({ data: { schoolId: seeded.schoolId, name: 'VII', order: 7 } });
    const section = await db.classSection.create({
      data: { schoolId: seeded.schoolId, gradeId: grade.id, name: 'B', academicYearId: year.id },
    });
    const window = await db.reportWindow.create({
      data: {
        schoolId: seeded.schoolId, academicYearId: year.id, name: 'Term I',
        startDate: new Date('2026-06-01'), endDate: new Date('2026-09-30'),
      },
    });
    const student = await db.student.create({
      data: {
        schoolId: seeded.schoolId, admissionNo: `F-${Date.now()}`,
        firstName: 'Flow', lastName: 'Child', classSectionId: section.id,
      },
    });

    const adminTok = signSchoolToken({ sub: seeded.adminUserId, schoolId: seeded.schoolId, role: 'SCHOOL_ADMIN' });
    const asSchool = { Authorization: `Bearer ${adminTok}`, 'X-Skoolos-Host': seeded.host };
    const asOperator = { Authorization: `Bearer ${signPlatformToken()}`, 'X-Skoolos-Host': loadEnv().PLATFORM_OWNER_HOST };
    const spec = { size: 'A4', colour: 'COLOUR', sides: 'DOUBLE', gsm: 130, finish: 'STAPLE' };
    const orderReq = { windowId: window.id, classSectionId: section.id, quantity: 40, ...spec };

    // Nothing issued yet — the counter refuses, because there is nothing frozen to print.
    await request(app.getHttpServer())
      .post('/manage/press/orders/report-cards').set(asSchool).send(orderReq)
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('ISSUED_BATCH_REQUIRED'));

    const snapshot = { kind: 'REPORT_CARD', windowName: 'Term I', classLabel: 'VII-B' };
    await db.pressIssue.create({
      data: {
        schoolId: seeded.schoolId, type: 'REPORT_CARD', serial: 'RC/2026/9101',
        studentId: student.id, windowId: window.id, payload: snapshot,
        issuedById: seeded.adminUserId,
      },
    });

    const created = await request(app.getHttpServer())
      .post('/manage/press/orders/report-cards').set(asSchool).send(orderReq)
      .expect(201);
    const orderId = created.body.id as string;
    expect(created.body.status).toBe('REQUESTED');
    expect(created.body.source).toMatchObject({ issuedCount: 1, serialFrom: 'RC/2026/9101' });

    // Another school's office cannot even see this order exists.
    await request(app.getHttpServer())
      .get(`/manage/press/orders/${orderId}`)
      .set({ Authorization: `Bearer ${adminToken}`, 'X-Skoolos-Host': host })
      .expect(404);

    // Confirming before a quote exists is refused — there is no price to accept.
    await request(app.getHttpServer())
      .post(`/manage/press/orders/${orderId}/confirm`).set(asSchool)
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('ORDER_TRANSITION_ILLEGAL'));

    // The artifact stays shut until the school commits.
    await request(app.getHttpServer())
      .get(`/owner/print-orders/${orderId}/artifact`).set(asOperator).expect(409);

    // The operator quotes: price + the logged promise.
    await request(app.getHttpServer())
      .post(`/owner/print-orders/${orderId}/quote`).set(asOperator)
      .send({ priceMinor: 240000, promisedBy: '2026-09-12', note: 'incl. delivery' })
      .expect(200);

    // The school reads the quote on its own timeline and confirms — freezing it.
    const afterQuote = await request(app.getHttpServer())
      .get(`/manage/press/orders/${orderId}`).set(asSchool).expect(200);
    expect(afterQuote.body.quote).toMatchObject({ priceMinor: 240000 });
    await request(app.getHttpServer())
      .post(`/manage/press/orders/${orderId}/confirm`).set(asSchool).expect(200);

    // Frozen means frozen: a re-quote after confirmation is refused.
    await request(app.getHttpServer())
      .post(`/owner/print-orders/${orderId}/quote`).set(asOperator)
      .send({ priceMinor: 999900, promisedBy: '2026-09-20' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/owner/print-orders/${orderId}/printing`).set(asOperator).expect(200);

    // What the operator prints is the register's frozen snapshot, verbatim.
    const artifact = await request(app.getHttpServer())
      .get(`/owner/print-orders/${orderId}/artifact`).set(asOperator).expect(200);
    expect(artifact.body).toEqual({
      kind: 'REPORT_CARDS',
      sheets: [{ serial: 'RC/2026/9101', snapshot }],
    });

    await request(app.getHttpServer())
      .post(`/owner/print-orders/${orderId}/delivered`).set(asOperator).expect(200);

    // The timeline holds the whole story, in order, with the promise logged.
    const done = await request(app.getHttpServer())
      .get(`/manage/press/orders/${orderId}`).set(asSchool).expect(200);
    expect(done.body.status).toBe('DELIVERED');
    expect(done.body.events.map((e: { action: string }) => e.action)).toEqual(
      ['REQUESTED', 'QUOTED', 'CONFIRMED', 'PRINTING', 'DELIVERED'],
    );
    expect(done.body.events[1]).toMatchObject({ actor: 'SCKOOLS', data: { priceMinor: 240000 } });
  });
});
