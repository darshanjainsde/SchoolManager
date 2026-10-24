import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { loadEnv } from '@skoolos/config';
import { disconnectAll } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { seedMinimalSchool, signPlatformToken, signSchoolToken, type MinimalSchool } from './integration/helpers';

/**
 * Who may call the Support desk.
 *
 * Two doors to one ticket: the school admin's (`/manage/support`, SCHOOL_ADMIN
 * only — a teacher or a driver does not report platform problems on the
 * school's behalf) and the owner's (`/owner/support`, platform JWT on the
 * owner host only). The same three claims per route as every other authz
 * suite: anonymous is rejected, the wrong roles are rejected, the right role
 * is not rejected FOR AUTHORIZATION reasons (a bogus id may still 400/404).
 *
 * Plus the platform wall from backups-authz: a school ADMIN's token opens
 * nothing on the owner host, and a platform token opens nothing on a school
 * host.
 */
const ID = '00000000-0000-0000-0000-000000000001';
type M = 'get' | 'post' | 'patch';

const SCHOOL_ROUTES: [M, string][] = [
  ['get', '/manage/support/counts'],
  ['get', '/manage/support'],
  ['post', '/manage/support'],
  ['get', `/manage/support/${ID}`],
  ['post', `/manage/support/${ID}/comment`],
  ['post', `/manage/support/${ID}/confirm`],
  ['post', `/manage/support/${ID}/reopen`],
  ['post', `/manage/support/${ID}/look-in`],
  ['get', `/manage/support/${ID}/file`],
];

const OWNER_ROUTES: [M, string][] = [
  ['get', '/owner/support/counts'],
  ['get', '/owner/support/board'],
  ['get', '/owner/support/tickets'],
  ['get', `/owner/support/${ID}`],
  ['post', `/owner/support/${ID}/status`],
  ['post', `/owner/support/${ID}/comment`],
  ['post', `/owner/support/${ID}/assign`],
  ['patch', `/owner/support/${ID}`],
  ['post', `/owner/support/${ID}/open-school`],
  ['get', `/owner/support/${ID}/file`],
];

describe('support desk authorization', () => {
  let app: INestApplication;
  let school: MinimalSchool;
  const tok: Record<string, string> = {};
  const ownerHost = loadEnv().PLATFORM_OWNER_HOST;

  beforeAll(async () => {
    school = await seedMinimalSchool();
    const { schoolId } = school;
    tok.student = signSchoolToken({ sub: school.studentUserId, schoolId, role: 'STUDENT' });
    tok.teacher = signSchoolToken({ sub: school.teacherUserId, schoolId, role: 'TEACHER' });
    tok.admin = signSchoolToken({ sub: school.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    tok.staff = signSchoolToken({ sub: school.staffUserId, schoolId, role: 'STAFF' });
    tok.owner = signPlatformToken();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const call = (method: M, path: string, headers: Record<string, string>) =>
    request(app.getHttpServer())[method](path).set(headers);
  const onSchool = (token?: string) => ({ 'X-Skoolos-Host': school.host, ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  const onOwner = (token?: string) => ({ 'X-Skoolos-Host': ownerHost, ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  const notAuthz = (res: request.Response) => expect([401, 403]).not.toContain(res.status);

  describe.each(SCHOOL_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller', async () => { await call(method, path, onSchool()).expect(401); });
    it('rejects a STUDENT', async () => { await call(method, path, onSchool(tok.student)).expect(403); });
    it('rejects a TEACHER', async () => { await call(method, path, onSchool(tok.teacher)).expect(403); });
    it('rejects non-admin STAFF', async () => { await call(method, path, onSchool(tok.staff)).expect(403); });
    it('lets the school admin through the guards', async () => { notAuthz(await call(method, path, onSchool(tok.admin))); });
  });

  describe.each(OWNER_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller on the owner host', async () => {
      await call(method, path, onOwner()).expect(401);
    });
    it("rejects a school ADMIN's token — a tenant credential opens nothing on the platform side", async () => {
      await call(method, path, onOwner(tok.admin)).expect(401);
    });
    it('rejects a platform token on a SCHOOL host', async () => {
      await call(method, path, onSchool(tok.owner)).expect(403);
    });
    it('lets the operator through the guards', async () => {
      notAuthz(await call(method, path, onOwner(tok.owner)));
    });
  });
});
