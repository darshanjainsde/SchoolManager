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
  let teacherUserId: string;
  let teacherUserId2: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    schoolId = seeded.schoolId;
    host = seeded.host;
    teacherUserId = seeded.teacherUserId;
    teacherUserId2 = seeded.teacherUserId2;
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });
    teacherToken = signSchoolToken({ sub: seeded.teacherUserId, schoolId, role: 'TEACHER' });
    teacher2Token = signSchoolToken({ sub: seeded.teacherUserId2, schoolId, role: 'TEACHER' });
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });

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
});
