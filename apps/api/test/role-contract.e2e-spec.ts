import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * The doors each portal actually walks through, asked of the REAL booted app.
 *
 * 2026-10-06, found on prod: `GET /me/profile` was declared by two controllers
 * — the family's (PortalController, STUDENT) and the staff "My profile" page
 * (MeProfileController). Express serves a path from the FIRST handler mounted,
 * AuthModule is imported before PortalModule, so every student's Profile tab,
 * Complaint Box and web portal home answered "Role not permitted" for two
 * weeks. Each controller's own tests were green; the one suite that called
 * `/me/profile` as a student is a live-API smoke test CI always skips.
 *
 * And every staff desk (office, library counter, sports desk, pay desk) shows
 * a bell over `/me/notifications`, whose controller never listed STAFF.
 *
 * These assertions are role-to-door, not controller-by-controller: they only
 * pass when the handler that WINS the route serves the caller.
 */
describe('role contract: each portal reaches its own doors', () => {
  let app: INestApplication;
  let host: string;
  let schoolId: string;
  let ids: Awaited<ReturnType<typeof seedMinimalSchool>>;
  const tok: Record<string, string> = {};

  beforeAll(async () => {
    ids = await seedMinimalSchool();
    host = ids.host;
    schoolId = ids.schoolId;
    const db = getPlatformPrisma();
    // A real pupil record behind the student login — the family profile is
    // the pupil, so without one the right handler can only answer 404.
    await db.student.create({
      data: { schoolId, userId: ids.studentUserId, admissionNo: 'RC-00001', firstName: 'Riya', lastName: 'Contract' },
    });
    tok.student = signSchoolToken({ sub: ids.studentUserId, schoolId, role: 'STUDENT' });
    tok.teacher = signSchoolToken({ sub: ids.teacherUserId, schoolId, role: 'TEACHER' });
    tok.admin = signSchoolToken({ sub: ids.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    tok.staff = signSchoolToken({ sub: ids.staffUserId, schoolId, role: 'STAFF' });
    tok.driver = signSchoolToken({ sub: ids.driverUserId, schoolId, role: 'STAFF' });
    // A STUDENT login with no pupil behind it (a half-made admission).
    const orphan = await db.user.create({
      data: { schoolId, email: `orphan-${Date.now()}@contract.test`, role: 'STUDENT', passwordHash: 'x' },
    });
    tok.orphan = signSchoolToken({ sub: orphan.id, schoolId, role: 'STUDENT' });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const call = (method: 'get' | 'post' | 'patch', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](path).set('X-Skoolos-Host', host);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('the family profile — GET /me/profile', () => {
    it('serves the student their own pupil record', async () => {
      const res = await call('get', '/me/profile', tok.student).expect(200);
      expect(res.body).toMatchObject({ firstName: 'Riya', lastName: 'Contract', admissionNo: 'RC-00001' });
    });

    it('answers a student login with no pupil record 404, never 403', async () => {
      await call('get', '/me/profile', tok.orphan).expect(404);
    });

    it.each(['teacher', 'admin', 'staff'])('refuses %s — the public sign-up probe relies on it', async (who) => {
      await call('get', '/me/profile', tok[who]).expect(403);
    });

    it('refuses an anonymous caller', async () => {
      await call('get', '/me/profile').expect(401);
    });
  });

  describe('the staff account page — /me/account', () => {
    it.each([
      ['teacher', 'TEACHER'],
      ['admin', 'SCHOOL_ADMIN'],
      ['staff', 'STAFF'],
    ])('serves %s their own login', async (who, role) => {
      const res = await call('get', '/me/account', tok[who]).expect(200);
      expect(res.body).toMatchObject({ role });
    });

    it('saves a name and reads it back', async () => {
      await call('patch', '/me/account', tok.teacher).send({ name: 'Anjali D.' }).expect(200);
      const res = await call('get', '/me/account', tok.teacher).expect(200);
      expect(res.body.name).toBe('Anjali D.');
    });

    it('rejects a name over 80 characters', async () => {
      await call('patch', '/me/account', tok.teacher).send({ name: 'x'.repeat(81) }).expect(400);
    });

    it.each(['get', 'patch'] as const)('refuses a student on %s', async (m) => {
      await call(m, '/me/account', tok.student).send({}).expect(403);
    });

    it('refuses an anonymous caller', async () => {
      await call('get', '/me/account').expect(401);
    });

    it('no longer answers PATCH /me/profile for staff (the family path is not theirs)', async () => {
      await call('patch', '/me/profile', tok.teacher).send({ name: 'x' }).expect(404);
    });
  });

  describe('the staff bell — /me/notifications', () => {
    beforeAll(async () => {
      const db = getPlatformPrisma();
      await db.notification.createMany({
        data: [
          { schoolId, userId: ids.staffUserId, kind: 'LEAVE_DECIDED', title: 'Your leave was approved' },
          // Someone else's row: the staff bell must never show it.
          { schoolId, userId: ids.teacherUserId, kind: 'MESSAGE', title: 'Not for staff' },
        ],
      });
    });

    it('lists only the staff member’s own notifications', async () => {
      const res = await call('get', '/me/notifications', tok.staff).expect(200);
      expect(res.body.notifications.map((n: { title: string }) => n.title)).toEqual(['Your leave was approved']);
      expect(res.body.unreadCount).toBe(1);
    });

    it('counts unread for the bell badge', async () => {
      const res = await call('get', '/me/notifications/unread-count', tok.staff).expect(200);
      expect(res.body).toEqual({ count: 1 });
    });

    it('marks read, then clears', async () => {
      const read = await call('post', '/me/notifications/read', tok.staff).send({}).expect(201);
      expect(read.body).toEqual({ count: 0 });
      await call('post', '/me/notifications/clear', tok.staff).send({}).expect(201);
      const res = await call('get', '/me/notifications', tok.staff).expect(200);
      expect(res.body.notifications).toEqual([]);
    });

    it('serves a non-office staff login (driver) too', async () => {
      await call('get', '/me/notifications/unread-count', tok.driver).expect(200);
    });

    it('leaves the teacher’s row untouched by the staff clear', async () => {
      const res = await call('get', '/me/notifications', tok.teacher).expect(200);
      expect(res.body.notifications.map((n: { title: string }) => n.title)).toContain('Not for staff');
    });

    it('refuses an anonymous caller', async () => {
      await call('get', '/me/notifications').expect(401);
    });
  });
});
