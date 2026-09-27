import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * Who may call the Complaint Box, the Class teachers desk and Onboarding.
 *
 * Three doors to the same concern, one per role, and each door refuses the
 * other two: a family reads and raises its OWN concerns (`/me/concerns`), the
 * class teacher answers the ones routed to them (`/teacher/concerns`), and the
 * office sees everything (`/manage/concerns`). Class teachers and the
 * onboarding sheets are office-only and behind MANAGEMENT.
 *
 * Same three claims per route as fees-authz: anonymous is rejected, the wrong
 * roles are rejected, the right role is not rejected FOR AUTHORIZATION reasons
 * (a bogus id may still 400/404 — that is validation, not access).
 */
const ID = '00000000-0000-0000-0000-000000000001';
type M = 'get' | 'post' | 'put' | 'delete';

/** Office only: `@Roles('SCHOOL_ADMIN')`. */
const OFFICE_ROUTES: [M, string][] = [
  ['get', '/manage/concerns/counts'],
  ['get', '/manage/concerns'],
  ['get', `/manage/concerns/${ID}`],
  ['post', `/manage/concerns/${ID}/comment`],
  ['post', `/manage/concerns/${ID}/status`],
  ['get', '/manage/class-teachers'],
  ['post', '/manage/class-teachers/copy'],
  ['put', `/manage/class-teachers/${ID}`],
  ['get', '/manage/onboarding/template/students'],
  ['get', '/manage/onboarding/status'],
  ['get', '/manage/onboarding/export/all'],
  ['get', '/manage/onboarding/export/students'],
  ['post', '/manage/onboarding/preview/students'],
  ['post', '/manage/onboarding/import/students'],
];

/** The class teacher's door: `@Roles('TEACHER')`. */
const TEACHER_ROUTES: [M, string][] = [
  ['get', '/teacher/concerns/counts'],
  ['get', '/teacher/concerns'],
  ['get', `/teacher/concerns/${ID}`],
  ['post', `/teacher/concerns/${ID}/comment`],
  ['post', `/teacher/concerns/${ID}/status`],
  ['post', `/teacher/concerns/${ID}/escalate`],
];

/** The family's door: `@Roles('STUDENT')` (parents and students share one login). */
const FAMILY_ROUTES: [M, string][] = [
  ['get', '/me/concerns'],
  ['post', '/me/concerns'],
  ['get', `/me/concerns/${ID}`],
  ['post', `/me/concerns/${ID}/comment`],
  ['post', `/me/concerns/${ID}/reopen`],
];

describe('concerns, class teachers and onboarding authorization', () => {
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
  const notAuthz = (res: request.Response) => expect([401, 403]).not.toContain(res.status);

  describe.each(OFFICE_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller', async () => { await call(method, path).expect(401); });
    it('rejects a STUDENT', async () => { await call(method, path, studentToken).expect(403); });
    it('rejects a TEACHER', async () => { await call(method, path, teacherToken).expect(403); });
    // The office desk here is the admin's, not general staff's — a driver
    // must not read every family's complaints.
    it('rejects non-admin STAFF', async () => { await call(method, path, staffToken).expect(403); });
    it('lets an admin through the guards', async () => { notAuthz(await call(method, path, adminToken)); });
  });

  describe.each(TEACHER_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller', async () => { await call(method, path).expect(401); });
    it('rejects a STUDENT', async () => { await call(method, path, studentToken).expect(403); });
    it('rejects an admin — the office has its own door', async () => { await call(method, path, adminToken).expect(403); });
    it('lets a TEACHER through the guards', async () => { notAuthz(await call(method, path, teacherToken)); });
  });

  describe.each(FAMILY_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller', async () => { await call(method, path).expect(401); });
    it('rejects a TEACHER', async () => { await call(method, path, teacherToken).expect(403); });
    it('rejects an admin', async () => { await call(method, path, adminToken).expect(403); });
    it('lets the family login through the guards', async () => { notAuthz(await call(method, path, studentToken)); });
  });
});
