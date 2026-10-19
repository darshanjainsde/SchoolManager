/**
 * Report and block on teacher <-> family threads, role to door, on real
 * Postgres through the booted API (Google Play user-generated content policy,
 * 19 Oct 2026).
 *
 * What is proven:
 *   - only the thread's own teacher / own student reach each door; another
 *     teacher or another student gets 404 (the thread is not theirs to see);
 *     the wrong role gets 403 and nobody signed in gets 401;
 *   - a report is saved and reaches the school's admins (outbox row);
 *   - a blocked thread refuses new messages from BOTH sides with 403
 *     THREAD_BLOCKED, the list says who blocked it, and unblocking reopens it.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool, type MinimalSchool } from './integration/helpers';

type Role = 'SCHOOL_ADMIN' | 'TEACHER' | 'STAFF' | 'STUDENT';

describe('message report and block: doors, reports, blocking', () => {
  let app: INestApplication;
  let school: MinimalSchool;
  let threadId: string;
  let messageId: string;
  let otherStudentUserId: string;
  const db = () => getPlatformPrisma();

  const as = (role: Role, sub: string) => {
    const h = { 'X-Skoolos-Host': school.host, Authorization: `Bearer ${signSchoolToken({ sub, schoolId: school.schoolId, role })}` };
    const s = () => request(app.getHttpServer());
    return {
      get: (url: string) => s().get(url).set(h),
      post: (url: string, body: object = {}) => s().post(url).set(h).send(body),
    };
  };
  const anon = () => request(app.getHttpServer());
  const teacher = () => as('TEACHER', school.teacherUserId);
  const otherTeacher = () => as('TEACHER', school.teacherUserId2);
  const student = () => as('STUDENT', school.studentUserId);
  const otherStudent = () => as('STUDENT', otherStudentUserId);
  const staff = () => as('STAFF', school.staffUserId);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    school = await seedMinimalSchool();
    const p = db();
    const sid = school.schoolId;
    const year = await p.academicYear.create({ data: { schoolId: sid, name: 'Msg 2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), isCurrent: true } });
    const grade = await p.grade.create({ data: { schoolId: sid, name: 'Class 5', order: 5 } });
    const subject = await p.subject.create({ data: { schoolId: sid, name: 'English', code: 'ENG' } });
    const t1 = await p.teacher.create({ data: { schoolId: sid, userId: school.teacherUserId, firstName: 'Rekha', lastName: 'Sinha' } });
    await p.teacher.create({ data: { schoolId: sid, userId: school.teacherUserId2, firstName: 'Other', lastName: 'Teacher' } });
    const section = await p.classSection.create({ data: { schoolId: sid, gradeId: grade.id, name: 'C', academicYearId: year.id, classTeacherId: t1.id } });
    const s1 = await p.student.create({ data: { schoolId: sid, admissionNo: 'M-1', firstName: 'Laksh', lastName: 'Pillai', classSectionId: section.id, userId: school.studentUserId } });
    const u2 = await p.user.create({ data: { schoolId: sid, email: `other-student@${school.host}`, role: 'STUDENT', passwordHash: 'x' } });
    otherStudentUserId = u2.id;
    await p.student.create({ data: { schoolId: sid, admissionNo: 'M-2', firstName: 'Diya', lastName: 'Rao', classSectionId: section.id, userId: u2.id } });
    // A family may only write to a teacher who teaches their class on the
    // timetable (NOT_YOUR_TEACHER otherwise), so give Rekha an English period
    // with V-C on every weekday — the send path then reaches the block check.
    const period = await p.period.create({ data: { schoolId: sid, order: 1, label: 'P1', startTime: '08:00', endTime: '08:40' } });
    for (const dayOfWeek of [1, 2, 3, 4, 5, 6]) {
      await p.timetableSlot.create({ data: { schoolId: sid, classSectionId: section.id, subjectId: subject.id, teacherId: t1.id, periodId: period.id, dayOfWeek, academicYearId: year.id, effectiveFrom: new Date('2026-04-01') } });
    }
    const thread = await p.messageThread.create({ data: { schoolId: sid, studentId: s1.id, teacherId: t1.id, subjectId: subject.id, classSectionId: section.id } });
    threadId = thread.id;
    messageId = (await p.message.create({ data: { schoolId: sid, threadId, senderRole: 'STUDENT', body: 'Hello ma’am' } })).id;
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  describe('doors', () => {
    it('nobody signed in: 401 on all four', async () => {
      for (const url of [`/manage/messages/${threadId}/report`, `/manage/messages/${threadId}/block`, `/me/messages/${threadId}/report`, `/me/messages/${threadId}/block`]) {
        expect((await anon().post(url).set('X-Skoolos-Host', school.host).send({ reason: 'x', blocked: true })).status).toBe(401);
      }
    });

    it('the wrong role: 403 (staff on the teacher door, a teacher on the family door)', async () => {
      expect((await staff().post(`/manage/messages/${threadId}/report`, { reason: 'x' })).status).toBe(403);
      expect((await teacher().post(`/me/messages/${threadId}/block`, { blocked: true })).status).toBe(403);
    });

    it('someone not on the thread: 404, the same as opening it', async () => {
      expect((await otherTeacher().post(`/manage/messages/${threadId}/report`, { reason: 'x' })).status).toBe(404);
      expect((await otherTeacher().post(`/manage/messages/${threadId}/block`, { blocked: true })).status).toBe(404);
      expect((await otherStudent().post(`/me/messages/${threadId}/report`, { reason: 'x' })).status).toBe(404);
      expect((await otherStudent().post(`/me/messages/${threadId}/block`, { blocked: true })).status).toBe(404);
    });
  });

  describe('report', () => {
    it('a blank reason is refused', async () => {
      expect((await student().post(`/me/messages/${threadId}/report`, { reason: '   ' })).status).toBe(400);
    });

    it('the family reports: saved, and every admin gets an outbox row', async () => {
      const before = await db().messageReport.count({ where: { threadId } });
      const res = await student().post(`/me/messages/${threadId}/report`, { reason: 'Rude or abusive', messageId });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true });
      expect(await db().messageReport.count({ where: { threadId } })).toBe(before + 1);
      const row = await db().messageReport.findFirst({ where: { threadId, reporterUserId: school.studentUserId }, orderBy: { createdAt: 'desc' } });
      expect(row).toMatchObject({ reason: 'Rude or abusive', messageId, reporterRole: 'STUDENT', status: 'OPEN' });
      const outbox = await db().notificationOutbox.findFirst({ where: { schoolId: school.schoolId, kind: 'MESSAGE_REPORTED', targetUserId: school.adminUserId } });
      expect(outbox).not.toBeNull();
    });

    it('the teacher reports too', async () => {
      expect((await teacher().post(`/manage/messages/${threadId}/report`, { reason: 'Spam or not about school' })).status).toBe(201);
    });

    it('a messageId from another thread is refused', async () => {
      expect((await student().post(`/me/messages/${threadId}/report`, { reason: 'x', messageId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    });
  });

  describe('block', () => {
    it('the family blocks: the teacher cannot reply, and both lists say who blocked it', async () => {
      const b = await student().post(`/me/messages/${threadId}/block`, { blocked: true });
      expect(b.status).toBe(200);
      expect(b.body).toEqual({ blocked: true });

      const reply = await teacher().post(`/manage/messages/${threadId}`, { body: 'Please see me tomorrow' });
      expect(reply.status).toBe(403);
      expect(reply.body.code).toBe('THREAD_BLOCKED');

      const mine = (await student().get('/me/messages')).body.find((t: { id: string }) => t.id === threadId);
      expect(mine).toMatchObject({ blockedByMe: true, blockedByOther: false });
      const theirs = (await teacher().get('/manage/messages')).body.find((t: { id: string }) => t.id === threadId);
      expect(theirs).toMatchObject({ blockedByMe: false, blockedByOther: true });
      const detail = (await teacher().get(`/manage/messages/${threadId}`)).body;
      expect(detail.thread).toMatchObject({ blockedByOther: true });
    });

    it('unblocking reopens the thread for both', async () => {
      expect((await student().post(`/me/messages/${threadId}/block`, { blocked: false })).body).toEqual({ blocked: false });
      expect((await teacher().post(`/manage/messages/${threadId}`, { body: 'Thank you' })).status).toBeLessThan(300);
    });

    it('the teacher blocks: the family cannot send in that thread', async () => {
      expect((await teacher().post(`/manage/messages/${threadId}/block`, { blocked: true })).status).toBe(200);
      const t = await db().messageThread.findUniqueOrThrow({ where: { id: threadId }, select: { teacherId: true, subjectId: true } });
      const send = await student().post('/me/messages', { teacherId: t.teacherId, subjectId: t.subjectId, body: 'Hello again' });
      expect(send.status).toBe(403);
      expect(send.body.code).toBe('THREAD_BLOCKED');
      await teacher().post(`/manage/messages/${threadId}/block`, { blocked: false });
    });
  });
});
