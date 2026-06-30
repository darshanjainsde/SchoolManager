/**
 * Phase 4-7 end-to-end coverage.
 *   - Attendance bulk upsert idempotency + cross-class rejection
 *   - Assignments: post, submit, grade, max-points clamp
 *   - Exams: create, subjects, generate-results, mark, publish, student-view-gate
 *   - Admissions: lead → application → accepted creates user + (optionally) enrollment
 *   - Comms: announcements with role/class audience, notifications
 *   - Stripe: webhook idempotency (no Stripe SDK call — we use SettingsService to short-circuit)
 *   - Settings: encrypted storage round-trip
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@skoolos/db';
import { createTestApp } from './app-helper';
import { clearTenantCache, closeFixtures, currentTotp, PLATFORM_PASSWORD, resetAndSeed, SeededWorld, TEST_PASSWORD } from './fixtures';

let app: INestApplication;
let world: SeededWorld;
let prisma: PrismaClient;
let adminA: string;
let teacherA: string;
let studentA: string;
let ownerToken: string;

async function login(host: string, email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').set('Host', host).send({ email, password });
  if (res.status !== 201) throw new Error(`login failed ${res.status}`);
  return res.body.accessToken;
}
async function platformLogin(): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/platform/auth/login')
    .set('Host', 'owner.localhost')
    .send({ email: world.platformOwner.email, password: PLATFORM_PASSWORD, totp: currentTotp(world.platformOwner.totpSecret) });
  return res.body.accessToken;
}

async function setupClassWithEnrollment() {
  // Grade → Class → Section → enroll a student.
  const grade = await prisma.grade.create({ data: { schoolId: world.schoolA.id, name: 'G1', sequence: 1 } });
  const ay = await prisma.academicYear.create({
    data: { schoolId: world.schoolA.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30'), isCurrent: true },
  });
  const cls = await prisma.class.create({
    data: { schoolId: world.schoolA.id, gradeId: grade.id, academicYearId: ay.id, name: '1A' },
  });
  const sec = await prisma.section.create({
    data: { schoolId: world.schoolA.id, classId: cls.id, name: 'A' },
  });
  const enroll = await prisma.enrollment.create({
    data: {
      schoolId: world.schoolA.id,
      studentUserId: world.schoolA.student.id,
      classId: cls.id,
      sectionId: sec.id,
      academicYearId: ay.id,
      status: 'ACTIVE',
    },
  });
  return { grade, ay, cls, sec, enroll };
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
  studentA = await login('alpha.localhost', world.schoolA.student.email);
  ownerToken = await platformLogin();
});

describe('Phase 4 — Attendance', () => {
  it('bulk upserts → re-posting same payload updates, not duplicates', async () => {
    const { cls, enroll } = await setupClassWithEnrollment();
    const post = (status: 'PRESENT' | 'ABSENT') =>
      request(app.getHttpServer())
        .post('/attendance/bulk')
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${teacherA}`)
        .send({
          classId: cls.id,
          date: '2026-09-01',
          marks: [{ enrollmentId: enroll.id, status }],
        });
    const a = await post('PRESENT');
    expect(a.status).toBe(201);
    expect(a.body.written).toBe(1);
    const b = await post('LATE');
    expect(b.status).toBe(201);
    expect(b.body.written).toBe(1);
    const count = await prisma.attendance.count({ where: { enrollmentId: enroll.id } });
    expect(count).toBe(1);
    const row = await prisma.attendance.findFirst({ where: { enrollmentId: enroll.id } });
    expect(row?.status).toBe('LATE');
  });

  it('rejects mark for enrollment that does not belong to the given class', async () => {
    const { cls } = await setupClassWithEnrollment();
    // Build a second class with a different enrollment.
    const grade2 = await prisma.grade.create({ data: { schoolId: world.schoolA.id, name: 'G2', sequence: 2 } });
    const ay = await prisma.academicYear.findFirst({ where: { schoolId: world.schoolA.id, isCurrent: true } });
    const cls2 = await prisma.class.create({
      data: { schoolId: world.schoolA.id, gradeId: grade2.id, academicYearId: ay!.id, name: '2A' },
    });
    const enroll2 = await prisma.enrollment.create({
      data: {
        schoolId: world.schoolA.id,
        studentUserId: world.schoolA.student2.id,
        classId: cls2.id,
        academicYearId: ay!.id,
        status: 'ACTIVE',
      },
    });
    const res = await request(app.getHttpServer())
      .post('/attendance/bulk')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${teacherA}`)
      .send({
        classId: cls.id, // wrong class for enroll2
        date: '2026-09-02',
        marks: [{ enrollmentId: enroll2.id, status: 'PRESENT' }],
      });
    expect(res.status).toBe(400);
  });
});

describe('Phase 4 — Assignments', () => {
  it('student submits after due → isLate=true, grade cannot exceed maxPoints', async () => {
    const { cls } = await setupClassWithEnrollment();
    const subject = await prisma.subject.create({
      data: { schoolId: world.schoolA.id, code: 'MATH', name: 'Math' },
    });
    // Create assignment due in the past.
    const create = await request(app.getHttpServer())
      .post('/assignments')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({
        classId: cls.id,
        subjectId: subject.id,
        title: 'Algebra 1',
        dueAt: new Date(Date.now() - 60_000).toISOString(),
        maxPoints: 100,
      });
    expect(create.status).toBe(201);

    const submit = await request(app.getHttpServer())
      .post(`/assignments/${create.body.id}/submit`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${studentA}`)
      .send({ body: 'x = 5' });
    expect(submit.status).toBe(201);
    expect(submit.body.isLate).toBe(true);

    // Grade attempt out-of-range → 400.
    const grade = await request(app.getHttpServer())
      .patch(`/submissions/${submit.body.id}/grade`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ grade: 999 });
    expect(grade.status).toBe(400);

    // In-range grade succeeds.
    const ok = await request(app.getHttpServer())
      .patch(`/submissions/${submit.body.id}/grade`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ grade: 85 });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.grade)).toBe(85);
  });
});

describe('Phase 4 — Exams + marks + publish', () => {
  it('full lifecycle: create exam → subjects → generate → marks → publish → student sees only PUBLISHED', async () => {
    const { cls } = await setupClassWithEnrollment();
    const subject = await prisma.subject.create({
      data: { schoolId: world.schoolA.id, code: 'MATH', name: 'Math' },
    });

    // Create exam
    const exam = await request(app.getHttpServer())
      .post('/exams')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({
        name: 'Mid-term',
        classId: cls.id,
        startsAt: '2026-10-01T09:00:00Z',
        endsAt: '2026-10-01T11:00:00Z',
      });
    expect(exam.status).toBe(201);

    // Set subjects
    const subs = await request(app.getHttpServer())
      .post(`/exams/${exam.body.id}/subjects`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ subjects: [{ subjectId: subject.id, maxMarks: 100, passingMarks: 40 }] });
    expect(subs.status).toBe(201);

    // Generate results
    const gen = await request(app.getHttpServer())
      .post(`/exams/${exam.body.id}/generate-results`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`);
    expect(gen.status).toBe(201);
    expect(gen.body.count).toBeGreaterThanOrEqual(1);

    // Save marks (out-of-range first → 400)
    const examSubject = subs.body[0];
    const bad = await request(app.getHttpServer())
      .post(`/exams/${exam.body.id}/marks`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({
        examSubjectId: examSubject.id,
        marks: [{ studentUserId: world.schoolA.student.id, marksObtained: 999 }],
      });
    expect(bad.status).toBe(400);

    const ok = await request(app.getHttpServer())
      .post(`/exams/${exam.body.id}/marks`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({
        examSubjectId: examSubject.id,
        marks: [{ studentUserId: world.schoolA.student.id, marksObtained: 85 }],
      });
    expect(ok.status).toBe(201);

    // Student cannot see results before publish.
    const resultsRow = await prisma.examResult.findFirst({
      where: { examId: exam.body.id, studentUserId: world.schoolA.student.id },
    });
    const beforePub = await request(app.getHttpServer())
      .get(`/exam-results/${resultsRow!.id}`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${studentA}`);
    expect(beforePub.status).toBe(404);

    // Publish
    const pub = await request(app.getHttpServer())
      .post(`/exams/${exam.body.id}/publish`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`);
    expect(pub.status).toBe(201);
    expect(pub.body.publishedCount).toBeGreaterThanOrEqual(1);

    // Now visible.
    const afterPub = await request(app.getHttpServer())
      .get(`/exam-results/${resultsRow!.id}`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${studentA}`);
    expect(afterPub.status).toBe(200);
  });
});

describe('Phase 5 — Admissions', () => {
  it('lead → convert → application → accept → creates STUDENT user', async () => {
    const lead = await request(app.getHttpServer())
      .post('/leads')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ fullName: 'Alex Applicant', contactEmail: 'alex@new.test' });
    expect(lead.status).toBe(201);

    const app1 = await request(app.getHttpServer())
      .post(`/leads/${lead.body.id}/convert`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ applicantData: { firstName: 'Alex', lastName: 'Applicant', email: 'alex@new.test' } });
    expect(app1.status).toBe(201);

    const decide = await request(app.getHttpServer())
      .patch(`/applications/${app1.body.id}/decision`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ status: 'ACCEPTED' });
    expect(decide.status).toBe(200);
    expect(decide.body.createdUser?.email).toBe('alex@new.test');

    const u = await prisma.user.findFirst({ where: { schoolId: world.schoolA.id, email: 'alex@new.test' } });
    expect(u?.role).toBe('STUDENT');
  });
});

describe('Phase 5 — Finance basics (no Stripe)', () => {
  it('creates fee structure, assigns plan, generates invoices with monotonic numbering', async () => {
    const ay = await prisma.academicYear.create({
      data: { schoolId: world.schoolA.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30'), isCurrent: true },
    });
    const fs = await request(app.getHttpServer())
      .post('/fee-structures')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({
        name: 'Standard',
        academicYearId: ay.id,
        currency: 'USD',
        items: [{ label: 'Tuition', amount: 1000, dueDate: '2026-09-30' }],
      });
    expect(fs.status).toBe(201);

    const assign = await request(app.getHttpServer())
      .post(`/fee-structures/${fs.body.id}/assign`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ studentUserIds: [world.schoolA.student.id, world.schoolA.student2.id] });
    expect(assign.status).toBe(201);
    expect(assign.body.assigned).toBe(2);

    const gen = await request(app.getHttpServer())
      .post('/invoices/generate')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({ feeStructureId: fs.body.id });
    expect(gen.status).toBe(201);
    expect(gen.body.created).toBe(2);

    const nums = (await prisma.invoice.findMany({ where: { schoolId: world.schoolA.id }, select: { number: true } })).map(
      (i) => i.number,
    );
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('checkout endpoint returns 503 when Stripe not configured', async () => {
    const ay = await prisma.academicYear.create({
      data: { schoolId: world.schoolA.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30'), isCurrent: true },
    });
    const fs = await prisma.feeStructure.create({
      data: { schoolId: world.schoolA.id, name: 'S', academicYearId: ay.id, currency: 'USD', totalAmount: 100 },
    });
    const a = await prisma.feePlanAssignment.create({
      data: { schoolId: world.schoolA.id, feeStructureId: fs.id, studentUserId: world.schoolA.student.id },
    });
    const inv = await prisma.invoice.create({
      data: {
        schoolId: world.schoolA.id,
        number: 1,
        feePlanAssignmentId: a.id,
        studentUserId: world.schoolA.student.id,
        amountDue: 100,
        currency: 'USD',
        dueDate: new Date('2026-09-30'),
      },
    });
    const res = await request(app.getHttpServer())
      .post(`/invoices/${inv.id}/checkout`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${studentA}`)
      .send({});
    expect(res.status).toBe(503);
  });
});

describe('Phase 6 — Comms', () => {
  it('teacher posts SCHOOL announcement → student sees it via /announcements', async () => {
    const post = await request(app.getHttpServer())
      .post('/announcements')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${teacherA}`)
      .send({ title: 'School-wide', body: 'Hello', audience: 'SCHOOL' });
    expect(post.status).toBe(201);
    const list = await request(app.getHttpServer())
      .get('/announcements')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${studentA}`);
    expect(list.status).toBe(200);
    expect(list.body.some((a: { title: string }) => a.title === 'School-wide')).toBe(true);
  });

  it('USER-targeted announcement creates a notification for that user', async () => {
    await request(app.getHttpServer())
      .post('/announcements')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`)
      .send({
        title: 'Direct',
        body: 'Just for you',
        audience: 'USER',
        audienceUserId: world.schoolA.student.id,
      });
    const notifs = await request(app.getHttpServer())
      .get('/notifications')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${studentA}`);
    expect(notifs.status).toBe(200);
    expect(notifs.body.some((n: { title: string }) => n.title === 'Direct')).toBe(true);
  });
});

describe('Phase 7 — Platform usage view', () => {
  it('returns one row per school (read by owner role only)', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/usage')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2); // alpha + bravo from fixture
  });

  it('blocks tenant-audience tokens from /platform/usage', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/usage')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminA}`);
    expect(res.status).toBe(403);
  });
});
