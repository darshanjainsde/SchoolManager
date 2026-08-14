import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

describe('management authorization', () => {
  let app: INestApplication;
  let schoolId: string;
  let host: string;
  let studentToken: string;
  let teacherToken: string;
  let teacher2Token: string;
  let adminToken: string;
  let staffToken: string;
  let teacherUserId: string;
  let teacherUserId2: string;
  let studentUserId: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    schoolId = seeded.schoolId;
    host = seeded.host;
    teacherUserId = seeded.teacherUserId;
    teacherUserId2 = seeded.teacherUserId2;
    studentUserId = seeded.studentUserId;
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });
    teacherToken = signSchoolToken({ sub: seeded.teacherUserId, schoolId, role: 'TEACHER' });
    teacher2Token = signSchoolToken({ sub: seeded.teacherUserId2, schoolId, role: 'TEACHER' });
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    staffToken = signSchoolToken({ sub: seeded.staffUserId, schoolId, role: 'STAFF' });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const as = (token: string) =>
    ({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': host });

  it('a STUDENT cannot list class sections', async () => {
    await request(app.getHttpServer())
      .get('/manage/classes')
      .set(as(studentToken))
      .expect(403);
  });

  it('a STUDENT cannot create a class section', async () => {
    await request(app.getHttpServer())
      .post('/manage/classes')
      .set(as(studentToken))
      .send({ gradeId: '00000000-0000-0000-0000-000000000001', name: 'Z' })
      .expect(403);
  });

  it('a TEACHER cannot delete a class section', async () => {
    await request(app.getHttpServer())
      .delete('/manage/classes/00000000-0000-0000-0000-000000000001')
      .set(as(teacherToken))
      .expect(403);
  });

  it('a TEACHER can still list class sections', async () => {
    await request(app.getHttpServer())
      .get('/manage/classes')
      .set(as(teacherToken))
      .expect(200);
  });

  it('a SCHOOL_ADMIN can list class sections', async () => {
    await request(app.getHttpServer())
      .get('/manage/classes')
      .set(as(adminToken))
      .expect(200);
  });

  it('a STUDENT cannot assign a timetable slot', async () => {
    await request(app.getHttpServer())
      .post('/manage/timetable')
      .set(as(studentToken))
      .send({})
      .expect(403);
  });

  it('a TEACHER cannot assign a timetable slot', async () => {
    await request(app.getHttpServer())
      .post('/manage/timetable')
      .set(as(teacherToken))
      .send({})
      .expect(403);
  });

  it('a STUDENT cannot unassign a timetable slot', async () => {
    await request(app.getHttpServer())
      .delete('/manage/timetable/00000000-0000-0000-0000-000000000001')
      .set(as(studentToken))
      .expect(403);
  });

  it('a TEACHER cannot unassign a timetable slot', async () => {
    await request(app.getHttpServer())
      .delete('/manage/timetable/00000000-0000-0000-0000-000000000001')
      .set(as(teacherToken))
      .expect(403);
  });

  it('a TEACHER can read their own day', async () => {
    const res = await request(app.getHttpServer())
      .get('/manage/timetable/my-day?date=2026-08-03')
      .set(as(teacherToken))
      .expect(200);
    expect(res.body).toHaveProperty('entries');
    expect(res.body.dayOfWeek).toBe(1);
  });

  it('a STUDENT cannot read a teacher day', async () => {
    await request(app.getHttpServer())
      .get('/manage/timetable/my-day')
      .set(as(studentToken))
      .expect(403);
  });

  it('my-day is matched before the class-scoped read', async () => {
    // A bare GET /manage/timetable without classSectionId must still 400,
    // proving the static route did not swallow it.
    await request(app.getHttpServer())
      .get('/manage/timetable')
      .set(as(teacherToken))
      .expect(400);
  });

  // ── STAFF portal: own attendance (Task 3, Phase 4) ─────────────────────────
  describe('staff-attendance mine — STAFF-only self-service read', () => {
    it('a STAFF login can read their own attendance summary', async () => {
      const res = await request(app.getHttpServer())
        .get('/manage/staff-attendance/mine?month=2026-08')
        .set(as(staffToken))
        .expect(200);
      expect(res.body).toHaveProperty('person');
      expect(res.body.person).toHaveProperty('firstName', 'Sam');
      expect(res.body).toHaveProperty('summary');
      expect(res.body.summary).toHaveProperty('days');
    });

    it('a STUDENT cannot read the staff-attendance mine route', async () => {
      await request(app.getHttpServer())
        .get('/manage/staff-attendance/mine')
        .set(as(studentToken))
        .expect(403);
    });

    it('a TEACHER cannot read the staff-attendance mine route (STAFF-only, distinct from the TEACHER-only /manage/leave/mine)', async () => {
      await request(app.getHttpServer())
        .get('/manage/staff-attendance/mine')
        .set(as(teacherToken))
        .expect(403);
    });

    it('a SCHOOL_ADMIN cannot read the staff-attendance mine route (still requires an actual linked Staff row, not just management access)', async () => {
      await request(app.getHttpServer())
        .get('/manage/staff-attendance/mine')
        .set(as(adminToken))
        .expect(403);
    });

    it('a STAFF login cannot list the full roster (that stays SCHOOL_ADMIN-only)', async () => {
      await request(app.getHttpServer())
        .get('/manage/staff-attendance?date=2026-08-03')
        .set(as(staffToken))
        .expect(403);
    });
  });

  // ── The staff RECORDS controller: SCHOOL_ADMIN-only, all of it ─────────────
  //
  // `StaffController` carried `SchoolJwtGuard + RequireFeatureGuard` at the
  // class level and `RolesGuard` only on the two login-invite handlers, with a
  // comment calling the rest "intentionally open to any authenticated
  // MANAGEMENT-feature role". `RequireFeatureGuard` asks whether the SCHOOL
  // bought the feature — never who is asking — and the only APP_GUARD is
  // ThrottlerGuard, so every one of these was reachable with a STUDENT token.
  // A child could read the staff roster with its emails and phone numbers, and
  // DELETE a staff record.
  //
  // Found while adding the LIBRARIAN role: minting a console login for someone
  // whose whole job is at a desk outside the console is what made "which
  // routes does a non-admin token actually reach" worth answering.
  describe('staff records — every route is SCHOOL_ADMIN-only', () => {
    it('a STUDENT cannot list staff', async () => {
      await request(app.getHttpServer())
        .get('/manage/staff')
        .set(as(studentToken))
        .expect(403);
    });

    it('a TEACHER cannot list staff', async () => {
      await request(app.getHttpServer())
        .get('/manage/staff')
        .set(as(teacherToken))
        .expect(403);
    });

    it('a STAFF login cannot list staff — being on the roster is not managing it', async () => {
      await request(app.getHttpServer())
        .get('/manage/staff')
        .set(as(staffToken))
        .expect(403);
    });

    it('a STUDENT cannot create a staff record', async () => {
      await request(app.getHttpServer())
        .post('/manage/staff')
        .set(as(studentToken))
        .send({ firstName: 'Not', lastName: 'Allowed', role: 'OTHER' })
        .expect(403);
    });

    // The one that matters most: a well-formed UUID from a non-admin token.
    // 403 must come from the guard, BEFORE the handler decides whether the row
    // exists — a 404 here would mean the authorization ran second.
    it('a TEACHER cannot delete a staff record', async () => {
      await request(app.getHttpServer())
        .delete('/manage/staff/00000000-0000-0000-0000-000000000001')
        .set(as(teacherToken))
        .expect(403);
    });

    it('a STUDENT cannot update a staff record', async () => {
      await request(app.getHttpServer())
        .put('/manage/staff/00000000-0000-0000-0000-000000000001')
        .set(as(studentToken))
        .send({ firstName: 'Edited' })
        .expect(403);
    });

    it('a SCHOOL_ADMIN can still list staff', async () => {
      await request(app.getHttpServer())
        .get('/manage/staff')
        .set(as(adminToken))
        .expect(200);
    });
  });

  // ── NotificationOutbox drain cron route (S6/S7 wiring, Task 2) ─────────────
  // Mirrors `internal/cron/exam-reminders`: no JWT exists for a cron
  // invocation, so the route is `@Public()` and gated by `CronSecretGuard`
  // instead. `CRON_SECRET` is unset in this e2e environment (see
  // test/integration/setup-env.ts), so the guard fails CLOSED — no header
  // could possibly match an unset secret — which is itself the behaviour
  // under test: an unconfigured/missing secret must never open this route.
  // Note: `CronSecretGuard` actually rejects with 401 UNAUTHORIZED (see
  // cron-secret.guard.ts / cron-secret.guard.spec.ts), not 403 — asserted
  // here against the guard's real, already-unit-tested behaviour.
  describe('internal/cron/notification-outbox — CronSecretGuard', () => {
    it('401s a GET with no cron secret header', async () => {
      const res = await request(app.getHttpServer())
        .get('/internal/cron/notification-outbox')
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('401s a POST with no cron secret header', async () => {
      const res = await request(app.getHttpServer())
        .post('/internal/cron/notification-outbox')
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('401s even with a bogus x-cron-secret header — never opens on a wrong guess', async () => {
      await request(app.getHttpServer())
        .post('/internal/cron/notification-outbox')
        .set('x-cron-secret', 'guessed-secret')
        .expect(401);
    });
  });

  // ── Announcements: own-post list/edit/delete (T16) ─────────────────────────
  // These rows are seeded directly via the platform Prisma client (bypasses
  // RLS, same technique seedMinimalSchool already uses for Users) rather
  // than through POST /manage/announcements — this disposable school has no
  // class sections, so a TEACHER create would 403 CLASS_NOT_OWNED before we
  // ever got a row to test against. `mine`/`update`/`remove` only need a
  // stored row with a known `createdByUserId`; how it got there is
  // irrelevant to the authorization behaviour under test.
  describe('announcements — mine / authorship-scoped edit+delete', () => {
    async function seedAnnouncement(createdByUserId: string, overrides: Record<string, unknown> = {}) {
      const db = getPlatformPrisma();
      return db.announcement.create({
        data: {
          schoolId,
          title: 'Original title',
          body: 'Original body',
          classSectionId: null,
          createdByUserId,
          ...overrides,
        },
      });
    }

    it('a STUDENT cannot list their own announcements', async () => {
      await request(app.getHttpServer())
        .get('/manage/announcements/mine')
        .set(as(studentToken))
        .expect(403);
    });

    it('a SCHOOL_ADMIN cannot use the TEACHER-only mine endpoint (they have the unfiltered list)', async () => {
      await request(app.getHttpServer())
        .get('/manage/announcements/mine')
        .set(as(adminToken))
        .expect(403);
    });

    it('a TEACHER sees only their own announcements, newest first — never another teacher’s', async () => {
      const older = await seedAnnouncement(teacherUserId, {
        title: 'Older post',
        createdAt: new Date('2026-07-01T00:00:00Z'),
      });
      const newer = await seedAnnouncement(teacherUserId, {
        title: 'Newer post',
        createdAt: new Date('2026-07-02T00:00:00Z'),
      });
      await seedAnnouncement(teacherUserId2, { title: 'Not this teacher’s post' });

      const res = await request(app.getHttpServer())
        .get('/manage/announcements/mine')
        .set(as(teacherToken))
        .expect(200);

      const titles = (res.body as Array<{ id: string; title: string }>).map((r) => r.title);
      expect(titles).toEqual(['Newer post', 'Older post']);
      expect(res.body[0].id).toBe(newer.id);
      expect(res.body[1].id).toBe(older.id);
      expect(titles).not.toContain('Not this teacher’s post');
    });

    it('a TEACHER can edit their own announcement', async () => {
      const own = await seedAnnouncement(teacherUserId);

      const res = await request(app.getHttpServer())
        .patch(`/manage/announcements/${own.id}`)
        .set(as(teacherToken))
        .send({ title: 'Fixed typo' })
        .expect(200);

      expect(res.body.title).toBe('Fixed typo');
    });

    // Deletion-proof: this test (and its remove() counterpart below) is
    // specifically here to fail if AnnouncementsService's authorship check
    // is ever removed/weakened — not just to exercise a 403 in the abstract.
    it('a TEACHER cannot edit ANOTHER teacher’s announcement', async () => {
      const theirs = await seedAnnouncement(teacherUserId);

      const res = await request(app.getHttpServer())
        .patch(`/manage/announcements/${theirs.id}`)
        .set(as(teacher2Token))
        .send({ title: 'Hijacked' })
        .expect(403);

      expect(res.body.code).toBe('ANNOUNCEMENT_NOT_OWNED');
    });

    it('a TEACHER can delete their own announcement', async () => {
      const own = await seedAnnouncement(teacherUserId);

      await request(app.getHttpServer())
        .delete(`/manage/announcements/${own.id}`)
        .set(as(teacherToken))
        .expect(200);
    });

    it('a TEACHER cannot delete ANOTHER teacher’s announcement', async () => {
      const theirs = await seedAnnouncement(teacherUserId);

      const res = await request(app.getHttpServer())
        .delete(`/manage/announcements/${theirs.id}`)
        .set(as(teacher2Token))
        .expect(403);

      expect(res.body.code).toBe('ANNOUNCEMENT_NOT_OWNED');

      // Still there — a rejected delete must not have touched the row.
      await request(app.getHttpServer())
        .patch(`/manage/announcements/${theirs.id}`)
        .set(as(teacherToken))
        .send({ title: 'Still mine' })
        .expect(200);
    });

    it('a SCHOOL_ADMIN can edit and delete any announcement, regardless of author (unchanged)', async () => {
      const row = await seedAnnouncement(teacherUserId);

      await request(app.getHttpServer())
        .patch(`/manage/announcements/${row.id}`)
        .set(as(adminToken))
        .send({ title: 'Admin edited' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/manage/announcements/${row.id}`)
        .set(as(adminToken))
        .expect(200);
    });

    it('a STUDENT cannot edit or delete an announcement', async () => {
      const row = await seedAnnouncement(teacherUserId);

      await request(app.getHttpServer())
        .patch(`/manage/announcements/${row.id}`)
        .set(as(studentToken))
        .send({ title: 'x' })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/manage/announcements/${row.id}`)
        .set(as(studentToken))
        .expect(403);
    });
  });

  // ── Assignments (T21, Phase 4 Task 4) ──────────────────────────────────────
  describe('assignments — role gates + student self-service', () => {
    let classSectionId: string;
    let subjectId: string;
    let studentId: string;
    let assignmentId: string;

    beforeAll(async () => {
      const db = getPlatformPrisma();
      const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const academicYear = await db.academicYear.create({
        data: {
          schoolId,
          name: `AY-${suffix}`,
          startDate: new Date('2026-06-01'),
          endDate: new Date('2027-03-31'),
          isCurrent: true,
        },
      });
      const grade = await db.grade.create({ data: { schoolId, name: `Grade-${suffix}`, order: 1 } });
      const section = await db.classSection.create({
        data: { schoolId, gradeId: grade.id, academicYearId: academicYear.id, name: `Sec-${suffix}` },
      });
      classSectionId = section.id;
      const subject = await db.subject.create({
        data: { schoolId, name: `Subject-${suffix}`, code: `SUB-${suffix}` },
      });
      subjectId = subject.id;
      // Links the seeded STUDENT-role User to a real Student domain row in
      // this class section — `/me/*` resolves everything from this link.
      const student = await db.student.create({
        data: {
          schoolId,
          classSectionId,
          admissionNo: `ADM-${suffix}`,
          firstName: 'Asha',
          lastName: 'Rao',
          userId: studentUserId,
        },
      });
      studentId = student.id;
      const assignment = await db.assignment.create({
        data: {
          schoolId,
          classSectionId,
          subjectId,
          title: 'Worksheet 3',
          instructions: 'Complete questions 1-10.',
          dueDate: new Date('2099-01-01'), // far future — always "upcoming"
          createdByTeacherId: teacherUserId,
        },
      });
      assignmentId = assignment.id;
    });

    it('a STUDENT cannot create an assignment', async () => {
      await request(app.getHttpServer())
        .post('/manage/assignments')
        .set(as(studentToken))
        .send({ classSectionId, subjectId, title: 'x', instructions: 'x', dueDate: '2026-08-05' })
        .expect(403);
    });

    it('a STAFF login cannot create an assignment (TEACHER/SCHOOL_ADMIN only)', async () => {
      await request(app.getHttpServer())
        .post('/manage/assignments')
        .set(as(staffToken))
        .send({ classSectionId, subjectId, title: 'x', instructions: 'x', dueDate: '2026-08-05' })
        .expect(403);
    });

    it('a STUDENT cannot list assignments', async () => {
      await request(app.getHttpServer())
        .get(`/manage/assignments?classSectionId=${classSectionId}`)
        .set(as(studentToken))
        .expect(403);
    });

    // Deletion-proof-style distinction: a role-gate 403 (ForbiddenException,
    // no `code`) is NOT the same failure as an ownership 403 (ApiError,
    // `code: 'CLASS_NOT_OWNED'`) — this proves teacher2 actually PASSED
    // RolesGuard and reached AssignmentsService's ownership check, rather
    // than merely proving "some 403 happened".
    it('a TEACHER who does not own the class section gets CLASS_NOT_OWNED, not a role-level 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/manage/assignments')
        .set(as(teacher2Token))
        .send({ classSectionId, subjectId, title: 'x', instructions: 'x', dueDate: '2026-08-05' })
        .expect(403);

      expect(res.body.code).toBe('CLASS_NOT_OWNED');
    });

    it('a TEACHER deleting a non-existent assignment gets 404 NOT_FOUND (proves the role gate + route work end-to-end)', async () => {
      const res = await request(app.getHttpServer())
        .delete('/manage/assignments/00000000-0000-0000-0000-000000000001')
        .set(as(teacherToken))
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    // This suite's per-test latency grows test-over-test under `--runInBand`
    // (each test opens a fresh connection against a distinct
    // `X-Skoolos-Host` subdomain — a harness/connection-pool characteristic
    // of THIS FILE, reproducible on tests that touch none of this task's
    // code) and occasionally spikes well past Jest's default 60s budget
    // before resetting on the next test. The assertion below is correct on
    // every run (a bare 403), it just sometimes arrives slowly — a generous
    // per-test timeout absorbs that without weakening what's being proven.
    it(
      'a STUDENT cannot upload an assignment attachment',
      async () => {
        await request(app.getHttpServer())
          .post('/manage/assignments/upload')
          .set(as(studentToken))
          .expect(403);
      },
      180_000,
    );

    it('a TEACHER can upload a PDF attachment via the shared storage machinery and gets back {url,name,kind}', async () => {
      const res = await request(app.getHttpServer())
        .post('/manage/assignments/upload')
        .set(as(teacherToken))
        .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'worksheet.pdf', contentType: 'application/pdf' })
        .expect(201);

      expect(res.body).toMatchObject({ name: 'worksheet.pdf', kind: 'pdf' });
      expect(typeof res.body.url).toBe('string');
      expect(res.body.url.length).toBeGreaterThan(0);
    });

    it('GET /me/assignments returns the student\'s own section\'s assignment in the upcoming bucket', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/assignments')
        .set(as(studentToken))
        .expect(200);

      expect(res.body.upcoming).toHaveLength(1);
      expect(res.body.upcoming[0]).toMatchObject({ id: assignmentId, title: 'Worksheet 3' });
      expect(res.body.past).toEqual([]);
    });

    it('a TEACHER cannot read /me/assignments (STUDENT-only)', async () => {
      await request(app.getHttpServer()).get('/me/assignments').set(as(teacherToken)).expect(403);
    });

    it('POST /me/assignments/:id/seen is idempotent — two calls leave exactly one AssignmentSeen row', async () => {
      await request(app.getHttpServer())
        .post(`/me/assignments/${assignmentId}/seen`)
        .set(as(studentToken))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/me/assignments/${assignmentId}/seen`)
        .set(as(studentToken))
        .expect(201);

      const rows = await getPlatformPrisma().assignmentSeen.findMany({
        where: { assignmentId, studentId },
      });
      expect(rows).toHaveLength(1);
    });

    it('a STUDENT cannot mark seen an assignment from another school (404, never leaks existence)', async () => {
      await request(app.getHttpServer())
        .post('/me/assignments/00000000-0000-0000-0000-000000000001/seen')
        .set(as(studentToken))
        .expect(404);
    });
  });
});
