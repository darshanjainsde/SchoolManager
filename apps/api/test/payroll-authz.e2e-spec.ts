import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * Who may call each Salary route.
 *
 * This module is different from every other one in the console, and the
 * difference is the whole reason these assertions exist: "is a school admin"
 * is NOT the answer. A head of department with admin rights has no business
 * reading the principal's pay, so the admin routes need a per-user right on
 * top of the role, and `/me/pay` must never be pointable at somebody else.
 *
 * Four claims per admin route: anonymous is refused, a STUDENT is refused, a
 * TEACHER is refused, and an admin who HOLDS the salary right is not refused
 * for authorization reasons (it may still 400/404 on a bogus id — that is
 * validation, not access). Plus: the module is shut entirely for a school
 * without the SALARY feature, which is in no tier.
 */

const ADMIN_ROUTES: [method: 'get' | 'post', path: string][] = [
  ['get', '/payroll/overview'],
  ['get', '/payroll/grades'],
  ['get', '/payroll/grades/suggest'],
  ['post', '/payroll/grades'],
  ['post', '/payroll/grades/preview'],
  ['post', '/payroll/grades/raise'],
  ['post', '/payroll/grades/assign'],
  ['post', '/payroll/grades/00000000-0000-0000-0000-000000000001/remove'],
  ['get', '/payroll/settings'],
  ['post', '/payroll/settings'],
  ['get', '/payroll/components'],
  ['post', '/payroll/components'],
  ['get', '/payroll/people'],
  ['get', '/payroll/people/teacher/00000000-0000-0000-0000-000000000001'],
  ['post', '/payroll/people/preview'],
  ['post', '/payroll/people/structure'],
  ['get', '/payroll/access'],
  ['post', '/payroll/access'],
  ['get', '/payroll/runs'],
  ['post', '/payroll/runs'],
  ['get', '/payroll/runs/00000000-0000-0000-0000-000000000001'],
  ['post', '/payroll/runs/00000000-0000-0000-0000-000000000001/calculate'],
  ['post', '/payroll/runs/00000000-0000-0000-0000-000000000001/approve'],
  ['post', '/payroll/runs/00000000-0000-0000-0000-000000000001/lock'],
  ['post', '/payroll/runs/00000000-0000-0000-0000-000000000001/paid'],
  ['get', '/payroll/runs/00000000-0000-0000-0000-000000000001/files/bank'],
  ['get', '/payroll/adjustments'],
  ['post', '/payroll/adjustments'],
  ['get', '/payroll/statutory/calendar'],
  ['get', '/payroll/statement/teacher/00000000-0000-0000-0000-000000000001'],
];

/** Everyone's own pay. A driver and a principal use the same routes. */
const MINE_ROUTES: [method: 'get' | 'post', path: string][] = [
  ['get', '/me/pay'],
  ['get', '/me/pay/payslips/00000000-0000-0000-0000-000000000001'],
  ['post', '/me/pay/declaration'],
  ['get', '/me/pay/statement'],
];

async function withSalary(schoolId: string) {
  await getPlatformPrisma().featureOverride.upsert({
    where: { schoolId_featureKey: { schoolId, featureKey: 'SALARY' } },
    create: { schoolId, featureKey: 'SALARY', enabled: true },
    update: { enabled: true },
  });
}

describe('salary authorization', () => {
  let app: INestApplication;
  let host: string;
  let schoolId: string;
  let studentToken: string;
  let adminToken: string;
  let staffToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    host = seeded.host;
    schoolId = seeded.schoolId;
    await withSalary(schoolId);
    // The migration grants the right to each EXISTING school's earliest admin;
    // this school was made afterwards, so the guard's self-healing path is what
    // lets the first admin in — and that is exactly what the test below proves.
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

  const call = (method: string, path: string, token?: string, h = host) => {
    const req = (request(app.getHttpServer()) as unknown as Record<string, (p: string) => request.Test>)[method](path);
    return token
      ? req.set({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': h })
      : req.set({ 'X-Skoolos-Host': h });
  };

  describe.each(ADMIN_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller', async () => {
      await call(method, path).expect(401);
    });

    it('rejects a STUDENT', async () => {
      await call(method, path, studentToken).expect(403);
    });

    it('rejects a TEACHER — a teacher sees their own pay, never the school’s', async () => {
      await call(method, path, teacherToken).expect(403);
    });

    it('rejects STAFF, however senior — the office is not the payroll', async () => {
      await call(method, path, staffToken).expect(403);
    });

    it('lets the admin who holds the salary right through the guards', async () => {
      const res = await call(method, path, adminToken);
      expect([401, 403]).not.toContain(res.status);
    });
  });

  describe.each(MINE_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller', async () => {
      await call(method, path).expect(401);
    });

    it('lets a teacher through to their own pay', async () => {
      const res = await call(method, path, teacherToken);
      expect([401, 403]).not.toContain(res.status);
    });

    it('lets a non-teaching staff member through to their own pay', async () => {
      const res = await call(method, path, staffToken);
      expect([401, 403]).not.toContain(res.status);
    });
  });

  it('shuts the whole module for a school without the SALARY feature, even for an admin', async () => {
    // SALARY is in no tier at all, so PRO is not enough — the override is the
    // only way in, and removing it must close every route rather than leave a
    // back door on one somebody bookmarked.
    const slug = `nosalary-${Date.now()}`;
    const db = getPlatformPrisma();
    const school = await db.school.create({ data: { slug, name: 'No Salary School', tier: 'PRO', status: 'LIVE' } });
    const user = await db.user.create({
      data: { schoolId: school.id, email: `a@${slug}.test`, role: 'SCHOOL_ADMIN', passwordHash: 'x', canSeeSalary: true },
    });
    const token = signSchoolToken({ sub: user.id, schoolId: school.id, role: 'SCHOOL_ADMIN' });
    const h = `${slug}.${loadEnv().PLATFORM_HOST}`;
    await call('get', '/payroll/settings', token, h).expect(403);
    await call('get', '/me/pay', token, h).expect(403);
  });

  it('refuses a SECOND admin who has not been given the right, and lets them in once it is granted', async () => {
    const db = getPlatformPrisma();
    const second = await db.user.create({
      data: { schoolId, email: `admin2-${Date.now()}@authz.test`, role: 'SCHOOL_ADMIN', passwordHash: 'x' },
    });
    const token = signSchoolToken({ sub: second.id, schoolId, role: 'SCHOOL_ADMIN' });

    // The first admin already holds it (granted on their first call above), so
    // the self-healing path does not apply to this one.
    await call('get', '/payroll/settings', token).expect(403);

    await call('post', '/payroll/access', adminToken).send({ userId: second.id, canSeeSalary: true }).expect(201);
    const after = await call('get', '/payroll/settings', token);
    expect([401, 403]).not.toContain(after.status);
  });

  it('will not let an admin take the salary right away from themselves', async () => {
    const me = await getPlatformPrisma().user.findFirst({
      where: { schoolId, role: 'SCHOOL_ADMIN', canSeeSalary: true },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true },
    });
    await call('post', '/payroll/access', adminToken).send({ userId: me!.id, canSeeSalary: false }).expect(400);
  });
});
