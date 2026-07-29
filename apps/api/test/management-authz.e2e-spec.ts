import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

describe('management authorization', () => {
  let app: INestApplication;
  let schoolId: string;
  let host: string;
  let studentToken: string;
  let teacherToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    schoolId = seeded.schoolId;
    host = seeded.host;
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });
    teacherToken = signSchoolToken({ sub: seeded.teacherUserId, schoolId, role: 'TEACHER' });
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
});
