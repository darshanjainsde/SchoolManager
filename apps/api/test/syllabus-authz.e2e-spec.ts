/**
 * The syllabus tracker, role to door, on real Postgres through the booted API.
 *
 * What is proven here, in the order a school would hit it:
 *   - the feature is in no tier: every door is shut until the owner's override;
 *   - who may knock (role), then who may MARK (the timetable decides, not the role);
 *   - chapters are shared by every section of a grade and outlive the year,
 *     progress belongs to one section — a sibling section opens with the same
 *     chapters and nothing ticked;
 *   - "reached here" semantics, sub-topic arithmetic, retire-never-delete;
 *   - a child reads their own section only, and their notes are theirs alone.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma, withTenant } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { FeatureResolverService } from '../src/modules/features';
import { istTodayISO } from '../src/common/dates/timetable-date';
import { signSchoolToken, seedMinimalSchool, type MinimalSchool } from './integration/helpers';

type Role = 'SCHOOL_ADMIN' | 'TEACHER' | 'STAFF' | 'STUDENT';

describe('syllabus tracker: doors, marking, sharing and privacy', () => {
  let app: INestApplication;
  let school: MinimalSchool;
  const db = () => getPlatformPrisma();
  const today = istTodayISO();
  const daysFromToday = (n: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + n * 86_400_000);

  // Fixture ids
  let grade9: string;
  let grade10: string;
  let maths: string;
  let science: string;
  let sec9A: string; // T1 is class teacher
  let sec9B: string; // T2 teaches maths here (slot); no class teacher
  let sec9C: string; // sibling section, nobody touched it
  let sec10A: string; // T2 is class teacher
  let t1: string;
  let t2: string;
  let student2UserId: string;
  let chNumbers: string; // 9 MAT leaf
  let chPoly: string; // 9 MAT parent
  let chZeroes: string; // 9 MAT sub-topic
  let chFactor: string; // 9 MAT sub-topic
  let chMatter: string; // 9 SCI leaf
  let chReal: string; // 10 MAT leaf

  const as = (role: Role, sub: string) => {
    const h = { 'X-Skoolos-Host': school.host, Authorization: `Bearer ${signSchoolToken({ sub, schoolId: school.schoolId, role })}` };
    const s = () => request(app.getHttpServer());
    return {
      get: (url: string) => s().get(url).set(h),
      post: (url: string, body: object = {}) => s().post(url).set(h).send(body),
      put: (url: string, body: object) => s().put(url).set(h).send(body),
      patch: (url: string, body: object) => s().patch(url).set(h).send(body),
      del: (url: string) => s().delete(url).set(h),
    };
  };
  const anon = () => request(app.getHttpServer());
  const admin = () => as('SCHOOL_ADMIN', school.adminUserId);
  const teacher1 = () => as('TEACHER', school.teacherUserId);
  const teacher2 = () => as('TEACHER', school.teacherUserId2);
  const staff = () => as('STAFF', school.staffUserId);
  const student = () => as('STUDENT', school.studentUserId);
  const track = (cs: string, subj: string) => `/manage/syllabus/tracks/${cs}/${subj}`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    school = await seedMinimalSchool();
    const p = db();
    const sid = school.schoolId;

    // The year is 200 working-ish days around today, so "expected" is ~50%.
    const year = await p.academicYear.create({ data: { schoolId: sid, name: 'Syl 2026-27', startDate: daysFromToday(-100), endDate: daysFromToday(100), isCurrent: true } });
    const g9 = await p.grade.create({ data: { schoolId: sid, name: 'Class 9', order: 9 } });
    const g10 = await p.grade.create({ data: { schoolId: sid, name: 'Class 10', order: 10 } });
    grade9 = g9.id;
    grade10 = g10.id;
    maths = (await p.subject.create({ data: { schoolId: sid, name: 'Mathematics', code: 'MAT' } })).id;
    science = (await p.subject.create({ data: { schoolId: sid, name: 'Science', code: 'SCI' } })).id;
    t1 = (await p.teacher.create({ data: { schoolId: sid, userId: school.teacherUserId, firstName: 'Priya', lastName: 'Nair' } })).id;
    t2 = (await p.teacher.create({ data: { schoolId: sid, userId: school.teacherUserId2, firstName: 'Rahul', lastName: 'Verma' } })).id;
    sec9A = (await p.classSection.create({ data: { schoolId: sid, gradeId: grade9, name: 'A', academicYearId: year.id, classTeacherId: t1 } })).id;
    sec9B = (await p.classSection.create({ data: { schoolId: sid, gradeId: grade9, name: 'B', academicYearId: year.id } })).id;
    sec9C = (await p.classSection.create({ data: { schoolId: sid, gradeId: grade9, name: 'C', academicYearId: year.id } })).id;
    sec10A = (await p.classSection.create({ data: { schoolId: sid, gradeId: grade10, name: 'A', academicYearId: year.id, classTeacherId: t2 } })).id;
    const period = await p.period.create({ data: { schoolId: sid, order: 1, label: 'P1', startTime: '08:00', endTime: '08:40' } });
    const slot = (classSectionId: string, subjectId: string, teacherId: string, dayOfWeek: number) =>
      p.timetableSlot.create({ data: { schoolId: sid, classSectionId, subjectId, teacherId, periodId: period.id, dayOfWeek, academicYearId: year.id, effectiveFrom: daysFromToday(-30) } });
    await slot(sec9B, maths, t2, 1); // T2: maths in 9-B
    await slot(sec9A, science, t2, 2); // T2: science in 9-A (T1 is its class teacher)
    await p.student.create({ data: { schoolId: sid, admissionNo: 'S-1', firstName: 'Aarav', lastName: 'Mehta', classSectionId: sec9A, userId: school.studentUserId } });
    const u2 = await p.user.create({ data: { schoolId: sid, email: `student2-${sid}@syl.test`, role: 'STUDENT', passwordHash: 'x' } });
    student2UserId = u2.id;
    await p.student.create({ data: { schoolId: sid, admissionNo: 'S-2', firstName: 'Diya', lastName: 'Rao', classSectionId: sec9A, userId: u2.id } });

    const ch = (gradeId: string, subjectId: string, title: string, order: number, parentId?: string) =>
      p.syllabusChapter.create({ data: { schoolId: sid, gradeId, subjectId, title, order, parentId: parentId ?? null } }).then((r) => r.id);
    chNumbers = await ch(grade9, maths, 'Number systems', 0);
    chPoly = await ch(grade9, maths, 'Polynomials', 1);
    chZeroes = await ch(grade9, maths, 'Zeroes of a polynomial', 0, chPoly);
    chFactor = await ch(grade9, maths, 'Factorisation', 1, chPoly);
    chMatter = await ch(grade9, science, 'Matter in our surroundings', 0);
    chReal = await ch(grade10, maths, 'Real numbers', 0);
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  // ── 1. The feature switch ──────────────────────────────────────────────────

  describe('with COURSE_MANAGEMENT off (a PRO school, no override)', () => {
    it('every door is shut, for every role, with 403 and never a payload', async () => {
      await admin().get('/manage/syllabus/overview').expect(403);
      await teacher1().get('/manage/syllabus/mine').expect(403);
      await teacher2().get(track(sec9B, maths)).expect(403);
      await student().get('/me/syllabus').expect(403);
    });
  });

  describe('once the owner switches it on', () => {
    beforeAll(async () => {
      await db().featureOverride.upsert({
        where: { schoolId_featureKey: { schoolId: school.schoolId, featureKey: 'COURSE_MANAGEMENT' } },
        create: { schoolId: school.schoolId, featureKey: 'COURSE_MANAGEMENT', enabled: true },
        update: { enabled: true },
      });
      await app.get(FeatureResolverService).invalidate(school.schoolId);
    });

    // ── 2. Role to door ──────────────────────────────────────────────────────

    it('GET /manage/syllabus/mine: a teacher gets the tracks the timetable gives them; nobody else gets in', async () => {
      const r1 = await teacher1().get('/manage/syllabus/mine').expect(200);
      // T1 is class teacher of 9-A: every subject planned or taught there.
      expect(r1.body.year).toMatchObject({ name: 'Syl 2026-27' });
      expect(r1.body.year.expectedPct).toBeGreaterThan(40);
      expect(r1.body.year.expectedPct).toBeLessThan(60);
      const t1Tracks = r1.body.tracks.map((t: { className: string; subjectName: string; isClassTeacher: boolean; teacher: { name: string } | null }) => [t.className, t.subjectName, t.isClassTeacher, t.teacher?.name ?? null]);
      expect(t1Tracks).toEqual([
        ['Class 9-A', 'Mathematics', true, null], // chapters exist, nobody on the timetable yet
        ['Class 9-A', 'Science', true, 'Rahul Verma'],
      ]);

      const r2 = await teacher2().get('/manage/syllabus/mine').expect(200);
      const t2Tracks = r2.body.tracks.map((t: { className: string; subjectName: string; isClassTeacher: boolean }) => [t.className, t.subjectName, t.isClassTeacher]);
      expect(t2Tracks).toEqual([
        ['Class 9-A', 'Science', false],
        ['Class 9-B', 'Mathematics', false],
        ['Class 10-A', 'Mathematics', true],
      ]);

      await admin().get('/manage/syllabus/mine').expect(403);
      await staff().get('/manage/syllabus/mine').expect(403);
      await student().get('/manage/syllabus/mine').expect(403);
      await anon().get('/manage/syllabus/mine').set('X-Skoolos-Host', school.host).expect(401);
    });

    it('GET /manage/syllabus/overview: the admin sees every current-year section against the year, worst first is the client\'s job', async () => {
      const r = await admin().get('/manage/syllabus/overview').expect(200);
      expect(r.body.grades.map((g: { name: string }) => g.name)).toEqual(['Class 9', 'Class 10']);
      expect(r.body.sections.map((s: { label: string }) => s.label)).toEqual(['Class 9-A', 'Class 9-B', 'Class 9-C', 'Class 10-A']);
      expect(r.body.subjects.map((s: { name: string }) => s.name)).toEqual(['Mathematics', 'Science']);
      expect(r.body.teachers.map((t: { name: string }) => t.name)).toEqual(['Rahul Verma']);
      const keys = r.body.tracks.map((t: { className: string; subjectName: string; leaves: number; pace: string }) => `${t.className} ${t.subjectName} ${t.leaves} ${t.pace}`);
      // Every section of Class 9 shares the three maths leaves; 9-A science has one; 10-A maths has one.
      expect(keys).toEqual([
        'Class 9-A Mathematics 3 bad',
        'Class 9-A Science 1 bad',
        'Class 9-B Mathematics 3 bad',
        'Class 9-B Science 1 bad',
        'Class 9-C Mathematics 3 bad',
        'Class 9-C Science 1 bad',
        'Class 10-A Mathematics 1 bad',
      ]);
      await teacher1().get('/manage/syllabus/overview').expect(403);
      await staff().get('/manage/syllabus/overview').expect(403);
      await student().get('/manage/syllabus/overview').expect(403);
      await anon().get('/manage/syllabus/overview').set('X-Skoolos-Host', school.host).expect(401);
    });

    it('GET /me/syllabus: a student reads their own section; a login with no student row is 404, not 403', async () => {
      const r = await student().get('/me/syllabus').expect(200);
      expect(r.body.className).toBe('Class 9-A');
      expect(r.body.subjects.map((s: { subjectName: string; teacher: string | null; leaves: number; pct: number }) => [s.subjectName, s.teacher, s.leaves, s.pct])).toEqual([
        ['Mathematics', null, 3, 0],
        ['Science', 'Rahul Verma', 1, 0],
      ]);
      const orphan = await as('STUDENT', randomUUID()).get('/me/syllabus');
      expect(orphan.status).toBe(404);
      expect(orphan.body.code).toBe('NOT_A_STUDENT');
      await teacher1().get('/me/syllabus').expect(403);
      await admin().get('/me/syllabus').expect(403);
      await staff().get('/me/syllabus').expect(403);
      await anon().get('/me/syllabus').set('X-Skoolos-Host', school.host).expect(401);
    });

    // ── 3. Opening a track: the timetable decides ────────────────────────────

    it('a subject teacher opens their track and may mark; a class teacher may mark any subject of their section', async () => {
      const r = await teacher2().get(track(sec9B, maths)).expect(200);
      expect(r.body.canEdit).toBe(true);
      expect(r.body.summary).toMatchObject({ className: 'Class 9-B', subjectName: 'Mathematics', leaves: 3, done: 0, pct: 0, pace: 'bad', now: { chapterId: chNumbers, title: 'Number systems' }, lastUpdatedAt: null, teacher: { name: 'Rahul Verma' } });
      expect(r.body.chapters.map((c: { title: string; children: { title: string }[] }) => [c.title, c.children.map((x) => x.title)])).toEqual([
        ['Number systems', []],
        ['Polynomials', ['Zeroes of a polynomial', 'Factorisation']],
      ]);
      // T1 holds no slot in 9-A maths, but is its class teacher.
      expect((await teacher1().get(track(sec9A, maths)).expect(200)).body.canEdit).toBe(true);
    });

    it('a teacher with no slot and no class is refused with 403 (never an empty track); the admin reads but cannot mark', async () => {
      const r = await teacher1().get(track(sec9B, maths));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('SUBJECT_NOT_OWNED');
      const a = await admin().get(track(sec9B, maths)).expect(200);
      expect(a.body.canEdit).toBe(false);
      expect(a.body.chapters).toHaveLength(2);
      await staff().get(track(sec9B, maths)).expect(403);
      await student().get(track(sec9B, maths)).expect(403);
      await anon().get(track(sec9B, maths)).set('X-Skoolos-Host', school.host).expect(401);
    });

    it('an unknown section or subject is 404; a malformed id is 400', async () => {
      expect((await teacher2().get(track(randomUUID(), maths))).status).toBe(404);
      expect((await admin().get(track(sec9B, randomUUID()))).status).toBe(404);
      expect((await admin().get(track('not-a-uuid', maths))).status).toBe(400);
    });

    // ── 4. Marking ───────────────────────────────────────────────────────────

    it('a chapter with sub-topics takes a note but not a status — its sub-topics decide', async () => {
      const bad = await teacher2().put(`${track(sec9B, maths)}/progress/${chPoly}`, { status: 'DONE' });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/sub-topics/);
      const ok = await teacher2().put(`${track(sec9B, maths)}/progress/${chPoly}`, { note: '  Revise Q4 before the test ' }).expect(200);
      const poly = ok.body.chapters.find((c: { id: string }) => c.id === chPoly);
      expect(poly).toMatchObject({ status: 'NOT_STARTED', note: 'Revise Q4 before the test', updatedBy: 'Rahul Verma' });
    });

    it('marking one sub-topic done moves the ring and the parent follows', async () => {
      const r = await teacher2().put(`${track(sec9B, maths)}/progress/${chZeroes}`, { status: 'DONE' }).expect(200);
      expect(r.body.summary).toMatchObject({ leaves: 3, done: 1, pct: 33 });
      const poly = r.body.chapters.find((c: { id: string }) => c.id === chPoly);
      expect(poly.status).toBe('TEACHING');
      expect(poly.children.map((c: { status: string }) => c.status)).toEqual(['DONE', 'NOT_STARTED']);
      expect(r.body.summary.lastUpdatedAt).not.toBeNull();
    });

    it('"reached here" marks everything before done and the target teaching; later leaves are left alone', async () => {
      const r = await teacher2().post(`${track(sec9B, maths)}/reach/${chFactor}`).expect(201);
      const flat = r.body.chapters.flatMap((c: { id: string; status: string; children: { id: string; status: string }[] }) => [[c.id, c.status], ...c.children.map((x) => [x.id, x.status])]);
      expect(flat).toEqual([
        [chNumbers, 'DONE'],
        [chPoly, 'TEACHING'],
        [chZeroes, 'DONE'],
        [chFactor, 'TEACHING'],
      ]);
      expect(r.body.summary).toMatchObject({ done: 2, teaching: 1, pct: 67, now: { chapterId: chFactor } });
      // Reaching backwards never un-does: reach the first leaf again, Zeroes stays DONE.
      const back = await teacher2().post(`${track(sec9B, maths)}/reach/${chNumbers}`).expect(201);
      expect(back.body.chapters[0].status).toBe('TEACHING');
      expect(back.body.chapters[1].children[0].status).toBe('DONE');
    });

    it('reach refuses a parent chapter (400), a chapter of another grade or subject (404), and a bad status value (400)', async () => {
      expect((await teacher2().post(`${track(sec9B, maths)}/reach/${chPoly}`)).status).toBe(400);
      expect((await teacher2().post(`${track(sec9B, maths)}/reach/${chReal}`)).status).toBe(404);
      expect((await teacher2().put(`${track(sec9B, maths)}/progress/${chMatter}`, { status: 'DONE' })).status).toBe(404);
      expect((await teacher2().put(`${track(sec9B, maths)}/progress/${chZeroes}`, { status: 'FINISHED' })).status).toBe(400);
      expect((await teacher2().put(`${track(sec9B, maths)}/progress/${chZeroes}`, { status: 'DONE', extra: 1 })).status).toBe(400);
    });

    it('only the marking roles mark: the admin, staff and a student are refused on the write doors', async () => {
      for (const who of [admin(), staff(), student()]) {
        await who.put(`${track(sec9B, maths)}/progress/${chZeroes}`, { status: 'DONE' }).expect(403);
        await who.post(`${track(sec9B, maths)}/reach/${chZeroes}`).expect(403);
      }
      await teacher1().put(`${track(sec9B, maths)}/progress/${chZeroes}`, { status: 'DONE' }).expect(403);
    });

    it("today's substitute reads the track but cannot mark it — a cover is a one-day grant", async () => {
      await db().substitution.create({ data: { schoolId: school.schoolId, classSectionId: sec9B, periodId: (await db().period.findFirstOrThrow({ where: { schoolId: school.schoolId } })).id, date: new Date(today), originalTeacherId: t2, substituteTeacherId: t1 } });
      const r = await teacher1().get(track(sec9B, maths)).expect(200);
      expect(r.body.canEdit).toBe(false);
      const w = await teacher1().put(`${track(sec9B, maths)}/progress/${chZeroes}`, { status: 'NOT_STARTED' });
      expect(w.status).toBe(403);
      expect(w.body.message).toMatch(/substitute/);
    });

    // ── 5. Sharing across sections, and the year ─────────────────────────────

    it('a sibling section opens with the same chapters and nothing ticked — new sessions import nothing', async () => {
      const r = await admin().get(track(sec9C, maths)).expect(200);
      expect(r.body.chapters.map((c: { title: string; status: string }) => [c.title, c.status])).toEqual([
        ['Number systems', 'NOT_STARTED'],
        ['Polynomials', 'NOT_STARTED'],
      ]);
      expect(r.body.summary).toMatchObject({ done: 0, pct: 0, lastUpdatedAt: null, teacher: null });
    });

    it('a section of a finished year measures against ITS year (expected 100%), not the current one', async () => {
      const old = await db().academicYear.create({ data: { schoolId: school.schoolId, name: 'Syl 2025-26', startDate: daysFromToday(-500), endDate: daysFromToday(-200) } });
      const oldSec = await db().classSection.create({ data: { schoolId: school.schoolId, gradeId: grade9, name: 'Z', academicYearId: old.id } });
      const r = await admin().get(track(oldSec.id, maths)).expect(200);
      expect(r.body.year).toMatchObject({ name: 'Syl 2025-26', expectedPct: 100 });
      expect(r.body.chapters).toHaveLength(2);
      // …and it is not in the current-year overview.
      const o = await admin().get('/manage/syllabus/overview').expect(200);
      expect(o.body.sections.some((s: { id: string }) => s.id === oldSec.id)).toBe(false);
    });

    // ── 6. Chapter lists ─────────────────────────────────────────────────────

    it('a class teacher or subject teacher of the grade may add chapters; one of another grade may not; the admin always may', async () => {
      // T1: class teacher of 9-A → may edit Class 9 Science, not Class 10 Maths.
      const list = await teacher1().get(`/manage/syllabus/chapters?gradeId=${grade9}&subjectId=${science}`).expect(200);
      expect(list.body).toMatchObject({ gradeName: 'Class 9', subjectName: 'Science', canEdit: true });
      expect((await teacher1().get(`/manage/syllabus/chapters?gradeId=${grade10}&subjectId=${maths}`).expect(200)).body.canEdit).toBe(false);
      const created = await teacher1().post('/manage/syllabus/chapters', { gradeId: grade9, subjectId: science, title: '  Is matter pure? ' }).expect(201);
      expect(created.body.id).toBeTruthy();
      const refused = await teacher1().post('/manage/syllabus/chapters', { gradeId: grade10, subjectId: maths, title: 'Triangles' });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('SUBJECT_NOT_OWNED');
      // T2: subject teacher of maths in 9-B → may edit Class 9 Maths (shared with 9-A and 9-C).
      await teacher2().post('/manage/syllabus/chapters', { gradeId: grade9, subjectId: maths, title: 'Coordinate geometry' }).expect(201);
      await admin().post('/manage/syllabus/chapters', { gradeId: grade10, subjectId: maths, title: 'Triangles' }).expect(201);
      await student().post('/manage/syllabus/chapters', { gradeId: grade9, subjectId: maths, title: 'x' }).expect(403);
      await staff().get(`/manage/syllabus/chapters?gradeId=${grade9}&subjectId=${maths}`).expect(403);
      // The new chapter appends after the existing ones and shows in every section of the grade.
      const sci9A = await teacher1().get(track(sec9A, science)).expect(200);
      expect(sci9A.body.chapters.map((c: { title: string }) => c.title)).toEqual(['Matter in our surroundings', 'Is matter pure?']);
    });

    it('validation: unknown grade/subject 404, a sub-topic of a sub-topic 400, a parent from another subject 404, a long title 400', async () => {
      expect((await admin().post('/manage/syllabus/chapters', { gradeId: randomUUID(), subjectId: maths, title: 'x' })).status).toBe(404);
      expect((await admin().post('/manage/syllabus/chapters', { gradeId: grade9, subjectId: randomUUID(), title: 'x' })).status).toBe(404);
      expect((await admin().post('/manage/syllabus/chapters', { gradeId: grade9, subjectId: maths, parentId: chZeroes, title: 'too deep' })).status).toBe(400);
      expect((await admin().post('/manage/syllabus/chapters', { gradeId: grade9, subjectId: science, parentId: chPoly, title: 'wrong subject' })).status).toBe(404);
      expect((await admin().post('/manage/syllabus/chapters', { gradeId: grade9, subjectId: maths, title: 'x'.repeat(161) })).status).toBe(400);
      expect((await admin().post('/manage/syllabus/chapters', { gradeId: grade9, subjectId: maths, title: '' })).status).toBe(400);
    });

    it('rename and reorder by PATCH; a student or staff cannot', async () => {
      await admin().patch(`/manage/syllabus/chapters/${chNumbers}`, { title: 'Number systems (revised)', order: 5 }).expect(200);
      const r = await admin().get(`/manage/syllabus/chapters?gradeId=${grade9}&subjectId=${maths}`).expect(200);
      expect(r.body.chapters.map((c: { title: string }) => c.title)).toEqual(['Polynomials', 'Coordinate geometry', 'Number systems (revised)']);
      await admin().patch(`/manage/syllabus/chapters/${chNumbers}`, { title: 'Number systems', order: 0 }).expect(200);
      await student().patch(`/manage/syllabus/chapters/${chNumbers}`, { title: 'x' }).expect(403);
      expect((await admin().patch(`/manage/syllabus/chapters/${randomUUID()}`, { title: 'x' })).status).toBe(404);
      expect((await admin().patch(`/manage/syllabus/chapters/${chNumbers}`, { order: -1 })).status).toBe(400);
    });

    it('retire never deletes: the chapter and its sub-topics leave every list, their progress rows stay', async () => {
      const before = await db().syllabusProgress.count({ where: { schoolId: school.schoolId, chapterId: { in: [chPoly, chZeroes, chFactor] } } });
      expect(before).toBeGreaterThan(0);
      await teacher2().del(`/manage/syllabus/chapters/${chPoly}`).expect(204);
      const list = await admin().get(`/manage/syllabus/chapters?gradeId=${grade9}&subjectId=${maths}`).expect(200);
      expect(list.body.chapters.map((c: { title: string }) => c.title)).toEqual(['Number systems', 'Coordinate geometry']);
      const t = await teacher2().get(track(sec9B, maths)).expect(200);
      expect(t.body.summary).toMatchObject({ leaves: 2, done: 0, teaching: 1 }); // Numbers is TEACHING from the reach-back above
      expect(await db().syllabusProgress.count({ where: { schoolId: school.schoolId, chapterId: { in: [chPoly, chZeroes, chFactor] } } })).toBe(before);
      // Retired is gone for marking too.
      expect((await teacher2().put(`${track(sec9B, maths)}/progress/${chZeroes}`, { status: 'DONE' })).status).toBe(404);
      expect((await teacher2().del(`/manage/syllabus/chapters/${chPoly}`)).status).toBe(404);
    });

    // ── 7. The child's view and private notes ────────────────────────────────

    it('a student sees the class move when the teacher marks, and the teacher\'s note', async () => {
      await teacher1().put(`${track(sec9A, science)}/progress/${chMatter}`, { status: 'DONE', note: 'Read the summary box' }).expect(200);
      const home = await student().get('/me/syllabus').expect(200);
      const sci = home.body.subjects.find((s: { subjectName: string }) => s.subjectName === 'Science');
      expect(sci).toMatchObject({ leaves: 2, done: 1, pct: 50, revised: 0, now: { chapterId: expect.any(String), title: 'Is matter pure?' } });
      const detail = await student().get(`/me/syllabus/subjects/${science}`).expect(200);
      expect(detail.body.chapters[0]).toMatchObject({ id: chMatter, status: 'DONE', teacherNote: 'Read the summary box', myNote: null });
    });

    it('a note is the child\'s own: saved, counted as revised, invisible to a classmate, cleared by an empty body', async () => {
      const saved = await student().put(`/me/syllabus/notes/${chMatter}`, { body: '  States: solid, liquid, gas ' }).expect(200);
      expect(saved.body).toEqual({ chapterId: chMatter, myNote: 'States: solid, liquid, gas' });
      const mine = await student().get(`/me/syllabus/subjects/${science}`).expect(200);
      expect(mine.body.chapters[0].myNote).toBe('States: solid, liquid, gas');
      expect(mine.body.subject).toMatchObject({ revised: 1, revisedPct: 50 });
      const classmate = await as('STUDENT', student2UserId).get(`/me/syllabus/subjects/${science}`).expect(200);
      expect(classmate.body.chapters[0].myNote).toBeNull();
      expect(classmate.body.subject.revised).toBe(0);
      await student().put(`/me/syllabus/notes/${chMatter}`, { body: '   ' }).expect(200);
      expect((await student().get(`/me/syllabus/subjects/${science}`).expect(200)).body.chapters[0].myNote).toBeNull();
    });

    it('a note on a chapter outside the child\'s grade is 404; the wrong shape is 400; other roles are 403', async () => {
      expect((await student().put(`/me/syllabus/notes/${chReal}`, { body: 'x' })).status).toBe(404);
      expect((await student().put(`/me/syllabus/notes/${chMatter}`, { body: 42 })).status).toBe(400);
      expect((await student().put(`/me/syllabus/notes/${chMatter}`, { body: 'x'.repeat(2001) })).status).toBe(400);
      expect((await student().get(`/me/syllabus/subjects/${randomUUID()}`)).status).toBe(404);
      await teacher1().put(`/me/syllabus/notes/${chMatter}`, { body: 'x' }).expect(403);
      await admin().get(`/me/syllabus/subjects/${science}`).expect(403);
      await anon().put(`/me/syllabus/notes/${chMatter}`).set('X-Skoolos-Host', school.host).send({ body: 'x' }).expect(401);
    });

    it('a student with no section yet gets an empty home, not an error', async () => {
      const u = await db().user.create({ data: { schoolId: school.schoolId, email: `nosec-${school.schoolId}@syl.test`, role: 'STUDENT', passwordHash: 'x' } });
      await db().student.create({ data: { schoolId: school.schoolId, admissionNo: 'S-9', firstName: 'New', lastName: 'Kid', userId: u.id } });
      const r = await as('STUDENT', u.id).get('/me/syllabus').expect(200);
      expect(r.body).toEqual({ className: null, year: null, subjects: [] });
      expect((await as('STUDENT', u.id).put(`/me/syllabus/notes/${chMatter}`, { body: 'x' })).status).toBe(404);
    });

    // ── 8. Tenant isolation on the three new tables ──────────────────────────

    it('another school sees none of our chapters, progress or notes, and cannot forge a row with our schoolId', async () => {
      const other = await db().school.create({ data: { slug: `syl-other-${Date.now()}`, name: 'Other', tier: 'PRO', status: 'LIVE' } });
      const seen = await withTenant(other.id, async (tx) => [await tx.syllabusChapter.count(), await tx.syllabusProgress.count(), await tx.syllabusStudentNote.count()]);
      expect(seen).toEqual([0, 0, 0]);
      await expect(
        withTenant(other.id, (tx) => tx.syllabusChapter.create({ data: { schoolId: school.schoolId, gradeId: grade9, subjectId: maths, title: 'forged' } })),
      ).rejects.toThrow(/row-level security|42501/);
      const ours = await withTenant(school.schoolId, (tx) => tx.syllabusChapter.count({ where: { retiredAt: null } }));
      expect(ours).toBe(6); // Numbers, Coord, Matter, Is matter pure, Real, Triangles
    });
  });
});
