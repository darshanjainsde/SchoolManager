import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * Who may call each fees route.
 *
 * Every route in the module is listed here, table-driven, so a new endpoint
 * that slips onto the controller without a decision about it fails
 * `route-coverage.e2e-spec.ts` rather than shipping open. This module moves
 * money, so "nobody looked at this route" is not an acceptable state for even
 * one handler.
 *
 * Three claims per office route: an anonymous caller is rejected, a STUDENT is
 * rejected, and an admin is not rejected *for authorization reasons* (it may
 * still 400/404 on a bogus payload — that is validation, not access).
 */

/** Every `/manage/fees/*` route: office only. */
const OFFICE_ROUTES: [method: 'get' | 'post' | 'put' | 'delete', path: string][] = [
  ['get', '/manage/fees/categories'],
  ['post', '/manage/fees/categories/seed'],
  ['put', '/manage/fees/categories'],
  ['delete', '/manage/fees/categories/00000000-0000-0000-0000-000000000001'],
  ['get', '/manage/fees/terms'],
  ['put', '/manage/fees/terms'],
  ['get', '/manage/fees/grid'],
  ['put', '/manage/fees/grid'],
  ['get', '/manage/fees/concessions'],
  ['post', '/manage/fees/concessions'],
  ['delete', '/manage/fees/concessions/00000000-0000-0000-0000-000000000001'],
  ['get', '/manage/fees/billing/preview'],
  ['post', '/manage/fees/billing/generate'],
  ['get', '/manage/fees/payment-setup'],
  ['put', '/manage/fees/payment-setup/bank'],
  ['post', '/manage/fees/payment-setup/bank/qr'],
  ['put', '/manage/fees/payment-setup/provider'],
  ['get', '/manage/fees/payments'],
  ['get', '/manage/fees/payments/pending-count'],
  ['post', '/manage/fees/payments/00000000-0000-0000-0000-000000000001/verify'],
  ['post', '/manage/fees/payments/00000000-0000-0000-0000-000000000001/reject'],
  ['post', '/manage/fees/payments/00000000-0000-0000-0000-000000000001/reverse'],
  ['post', '/manage/fees/payments/record'],
  ['get', '/manage/fees/summary'],
  ['get', '/manage/fees/students/00000000-0000-0000-0000-000000000001'],
  ['get', '/manage/fees/defaulters'],
];

/** Every `/me/fees/*` route: the signed-in student/parent only. */
const PORTAL_ROUTES: [method: 'get' | 'post', path: string][] = [
  ['get', '/me/fees'],
  ['get', '/me/fees/how-to-pay'],
  ['get', '/me/fees/bank-instructions'],
  ['post', '/me/fees/submit'],
];

describe('fees authorization', () => {
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

    it('rejects a TEACHER — fees are not a teacher’s business', async () => {
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

    it('rejects an admin — /me/* is the student’s own record', async () => {
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

  it('gates the whole module behind the FEES feature', async () => {
    // A school without the feature gets 403 even as an admin. Downgrading a
    // tier must close the module, not leave a back door on a route someone
    // bookmarked.
    const { getPlatformPrisma } = await import('@skoolos/db');
    const db = getPlatformPrisma();
    const basic = await db.school.create({
      data: { slug: `basic-${Date.now()}`, name: 'Basic School', tier: 'BASIC', status: 'LIVE' },
    });
    const user = await db.user.create({
      data: { schoolId: basic.id, email: `a@basic-${Date.now()}.test`, role: 'SCHOOL_ADMIN', passwordHash: 'x' },
    });
    const token = signSchoolToken({ sub: user.id, schoolId: basic.id, role: 'SCHOOL_ADMIN' });
    const { loadEnv } = await import('@skoolos/config');

    await request(app.getHttpServer())
      .get('/manage/fees/categories')
      .set({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': `${basic.slug}.${loadEnv().PLATFORM_HOST}` })
      .expect(403);
  });
});
