/**
 * Phase 3 — academics CRUD + tenant isolation gates.
 *
 * Every test:
 *   1. Creates a resource in school A.
 *   2. Asserts a school-B token returns 404/0-rows (RLS in effect).
 *   3. Asserts the right role guard (TEACHER cannot POST /grades).
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@skoolos/db';
import { createTestApp } from './app-helper';
import { clearTenantCache, closeFixtures, resetAndSeed, SeededWorld, TEST_PASSWORD } from './fixtures';

let app: INestApplication;
let world: SeededWorld;
let prisma: PrismaClient;
let adminA: string;
let teacherA: string;
let adminB: string;

async function login(host: string, email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Host', host)
    .send({ email, password });
  if (res.status !== 201) throw new Error(`login failed: ${res.status} ${res.text}`);
  return res.body.accessToken;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
});
afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await closeFixtures();
});
beforeEach(async () => {
  world = await resetAndSeed();
  await clearTenantCache();
  adminA = await login('alpha.localhost', world.schoolA.admin.email);
  teacherA = await login('alpha.localhost', world.schoolA.teacher.email);
  adminB = await login('bravo.localhost', world.schoolB.admin.email);
});

describe('Phase 3 — Grades', () => {
  it('admin creates → lists → deletes', async () => {
    const create = await request(app.getHttpServer())
      .post('/grades')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ name: 'Grade 1', sequence: 1 });
    expect(create.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get('/grades')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await request(app.getHttpServer())
      .delete(`/grades/${create.body.id}`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`);
    expect(del.status).toBe(200);
  });

  it('teacher cannot create a grade', async () => {
    const res = await request(app.getHttpServer())
      .post('/grades')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${teacherA}`)
      .send({ name: 'Grade 1', sequence: 1 });
    expect(res.status).toBe(403);
  });

  it('teacher CAN list grades', async () => {
    await request(app.getHttpServer())
      .post('/grades')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ name: 'Grade 1', sequence: 1 });
    const res = await request(app.getHttpServer())
      .get('/grades')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${teacherA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('tenant isolation: school B cannot see school A grades', async () => {
    await request(app.getHttpServer())
      .post('/grades')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ name: 'Grade A', sequence: 1 });
    const res = await request(app.getHttpServer())
      .get('/grades')
      .set('Host', 'bravo.localhost')
      .set('Authorization', `Bearer ${adminB}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('409 on duplicate sequence', async () => {
    await request(app.getHttpServer())
      .post('/grades')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ name: 'G1', sequence: 1 });
    const dup = await request(app.getHttpServer())
      .post('/grades')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ name: 'G2', sequence: 1 });
    expect(dup.status).toBe(409);
  });
});

describe('Phase 3 — Classes & Sections', () => {
  async function makeGrade(token: string, host: string, name = 'Grade 1', sequence = 1) {
    const res = await request(app.getHttpServer())
      .post('/grades').set('Host', host).set('Authorization', `Bearer ${token}`).send({ name, sequence });
    return res.body.id as string;
  }
  async function currentYear(schoolId: string): Promise<string> {
    const ay = await prisma.academicYear.findFirst({ where: { schoolId, isCurrent: true } });
    if (!ay) {
      const created = await prisma.academicYear.create({
        data: { schoolId, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30'), isCurrent: true },
      });
      return created.id;
    }
    return ay.id;
  }

  it('create class → add section → list', async () => {
    const gradeId = await makeGrade(adminA, 'alpha.localhost');
    const academicYearId = await currentYear(world.schoolA.id);
    const cls = await request(app.getHttpServer())
      .post('/classes').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ gradeId, academicYearId, name: '1A' });
    expect(cls.status).toBe(201);

    const sec = await request(app.getHttpServer())
      .post('/sections').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ classId: cls.body.id, name: 'A' });
    expect(sec.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get('/classes').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`);
    expect(list.status).toBe(200);
    expect(list.body[0].sections).toHaveLength(1);
  });

  it('rejects class creation against another school\'s grade', async () => {
    const gradeBId = await makeGrade(adminB, 'bravo.localhost');
    const aYear = await currentYear(world.schoolA.id);
    const res = await request(app.getHttpServer())
      .post('/classes').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ gradeId: gradeBId, academicYearId: aYear, name: '1A' });
    expect(res.status).toBe(400);
  });
});

describe('Phase 3 — Subjects', () => {
  it('code is uppercased on create and unique per school', async () => {
    const a = await request(app.getHttpServer())
      .post('/subjects').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ code: 'math', name: 'Mathematics' });
    expect(a.status).toBe(201);
    expect(a.body.code).toBe('MATH');

    const dup = await request(app.getHttpServer())
      .post('/subjects').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ code: 'MATH', name: 'Math II' });
    expect(dup.status).toBe(409);

    // Same code is fine in another school.
    const inB = await request(app.getHttpServer())
      .post('/subjects').set('Host', 'bravo.localhost').set('Authorization', `Bearer ${adminB}`)
      .send({ code: 'MATH', name: 'Math' });
    expect(inB.status).toBe(201);
  });
});

describe('Phase 3 — Enrollments', () => {
  it('admin enrolls a student → list reflects → cannot enroll across schools', async () => {
    const gradeRes = await request(app.getHttpServer())
      .post('/grades').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ name: 'G1', sequence: 1 });
    const aYear = await prisma.academicYear.create({
      data: { schoolId: world.schoolA.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30'), isCurrent: true },
    });
    const cls = await request(app.getHttpServer())
      .post('/classes').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ gradeId: gradeRes.body.id, academicYearId: aYear.id, name: '1A' });

    const enroll = await request(app.getHttpServer())
      .post('/enrollments').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ studentUserId: world.schoolA.student.id, classId: cls.body.id, academicYearId: aYear.id });
    expect(enroll.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get('/enrollments').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`);
    expect(list.body).toHaveLength(1);

    // Trying to enroll a school-B student via school-A's host fails (the user
    // does not exist under tenant A's RLS scope → 400 "not a STUDENT").
    const cross = await request(app.getHttpServer())
      .post('/enrollments').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ studentUserId: world.schoolB.student.id, classId: cls.body.id, academicYearId: aYear.id });
    expect(cross.status).toBe(400);
  });

  it('transitions from ACTIVE → WITHDRAWN and stamps exitedAt', async () => {
    const gradeRes = await request(app.getHttpServer())
      .post('/grades').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ name: 'G1', sequence: 1 });
    const aYear = await prisma.academicYear.create({
      data: { schoolId: world.schoolA.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30'), isCurrent: true },
    });
    const cls = await request(app.getHttpServer())
      .post('/classes').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ gradeId: gradeRes.body.id, academicYearId: aYear.id, name: '1A' });
    const enroll = await request(app.getHttpServer())
      .post('/enrollments').set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ studentUserId: world.schoolA.student.id, classId: cls.body.id, academicYearId: aYear.id });

    const t = await request(app.getHttpServer())
      .patch(`/enrollments/${enroll.body.id}/transition`).set('Host', 'alpha.localhost').set('Authorization', `Bearer ${adminA}`)
      .send({ status: 'WITHDRAWN' });
    expect(t.status).toBe(200);
    expect(t.body.status).toBe('WITHDRAWN');
    expect(t.body.exitedAt).toBeTruthy();
  });
});
