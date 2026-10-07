import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';
import { istTodayISO } from '../src/common/dates/timetable-date';

/**
 * CHANGING WHO TEACHES A SUBJECT, against the REAL booted app (2026-10-07).
 *
 * The office asked: "I changed the English teacher of a class and had to redo
 * every English period of the week, one by one." The timetable is a run of
 * dated versions per period; these tests hold the promises the new dialog makes:
 *  - the past is never rewritten — a past date reads the old teacher, and a
 *    `from` before today is clamped to today;
 *  - "from now on" runs into every coming week; "this week only" brings the
 *    earlier teacher back on the next Monday by itself;
 *  - a period where the new teacher already teaches another class is never
 *    forced: the preview names the class, and applying skips it;
 *  - other classes and other subjects are untouched.
 */
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = istTodayISO();
const todayUtc = new Date(`${TODAY}T00:00:00Z`);
const weekday = (todayUtc.getUTCDay() || 7); // 1 = Monday
const NEXT_MON = iso(new Date(todayUtc.getTime() + (8 - weekday) * DAY));
const MON_AFTER = iso(new Date(todayUtc.getTime() + (15 - weekday) * DAY));
const TUE_AFTER_NEXT = iso(new Date(todayUtc.getTime() + (16 - weekday) * DAY));
const PAST = '2026-06-15';

describe('timetable: giving a subject to another teacher', () => {
  let app: INestApplication;
  let s: Awaited<ReturnType<typeof seedMinimalSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    s = await seedMinimalSchool();
    const db = getPlatformPrisma();
    const schoolId = s.schoolId;
    const year = await db.academicYear.create({ data: { schoolId, name: '2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') } });
    const g5 = await db.grade.create({ data: { schoolId, name: 'V', order: 5 } });
    const g7 = await db.grade.create({ data: { schoolId, name: 'VII', order: 7 } });
    const vb = await db.classSection.create({ data: { schoolId, gradeId: g5.id, name: 'B', academicYearId: year.id } });
    const viia = await db.classSection.create({ data: { schoolId, gradeId: g7.id, name: 'A', academicYearId: year.id } });
    const eng = await db.subject.create({ data: { schoolId, name: 'English', code: 'ENG' } });
    const hin = await db.subject.create({ data: { schoolId, name: 'Hindi', code: 'HIN' } });
    const p1 = await db.period.create({ data: { schoolId, order: 1, label: 'I', startTime: '08:00', endTime: '08:45' } });
    const p2 = await db.period.create({ data: { schoolId, order: 2, label: 'II', startTime: '08:45', endTime: '09:30' } });
    const krishna = await db.teacher.create({ data: { schoolId, firstName: 'Krishna', lastName: 'Shah' } });
    const rishika = await db.teacher.create({ data: { schoolId, firstName: 'Rishika', lastName: 'Agarwal' } });
    const sandeep = await db.teacher.create({ data: { schoolId, firstName: 'Sandeep', lastName: 'Chauhan' } });
    const gone = await db.teacher.create({ data: { schoolId, firstName: 'Former', lastName: 'Teacher', isActive: false, status: 'LEFT' } });
    Object.assign(ids, { year: year.id, vb: vb.id, viia: viia.id, eng: eng.id, hin: hin.id, p1: p1.id, p2: p2.id, krishna: krishna.id, rishika: rishika.id, sandeep: sandeep.id, gone: gone.id });

    const since = new Date(`${PAST}T00:00:00+05:30`);
    const slot = (classSectionId: string, dayOfWeek: number, periodId: string, subjectId: string, teacherId: string) =>
      db.timetableSlot.create({ data: { schoolId, classSectionId, dayOfWeek, periodId, subjectId, teacherId, academicYearId: year.id, effectiveFrom: since } });
    // V-B English with Krishna on Mon I, Tue I, Wed II; Hindi with Sandeep on Thu I.
    await slot(vb.id, 1, p1.id, eng.id, krishna.id);
    await slot(vb.id, 2, p1.id, eng.id, krishna.id);
    await slot(vb.id, 3, p2.id, eng.id, krishna.id);
    await slot(vb.id, 4, p1.id, hin.id, sandeep.id);
    // Rishika already teaches VII-A on Tue I — the clash.
    await slot(viia.id, 2, p1.id, eng.id, rishika.id);

    tok.admin = signSchoolToken({ sub: s.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    tok.teacher = signSchoolToken({ sub: s.teacherUserId, schoolId, role: 'TEACHER' });
    tok.staff = signSchoolToken({ sub: s.staffUserId, schoolId, role: 'STAFF' });
    tok.student = signSchoolToken({ sub: s.studentUserId, schoolId, role: 'STUDENT' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const as = (token?: string) => {
    const wrap = (r: request.Test) => { r.set('X-Skoolos-Host', s.host); return token ? r.set('Authorization', `Bearer ${token}`) : r; };
    return {
      post: (p: string) => wrap(request(app.getHttpServer()).post(p)),
      get: (p: string) => wrap(request(app.getHttpServer()).get(p)),
      del: (p: string) => wrap(request(app.getHttpServer()).delete(p)),
    };
  };
  const admin = () => as(tok.admin);
  const body = (over: Record<string, unknown> = {}) => ({ classSectionId: ids.vb, academicYearId: ids.year, subjectId: ids.eng, teacherId: ids.rishika, ...over });
  /** Who teaches V-B on that weekday/period, as read on `date`. */
  const who = async (date: string, dayOfWeek: number, periodId: string, classId = ids.vb) => {
    const res = await admin().get(`/manage/timetable?classSectionId=${classId}&date=${date}`).expect(200);
    const hit = (res.body as { dayOfWeek: number; periodId: string; teacher: { firstName: string }; subject: { name: string } }[]).find((x) => x.dayOfWeek === dayOfWeek && x.periodId === periodId);
    return hit ? `${hit.subject.name}:${hit.teacher.firstName}` : null;
  };
  /** Put V-B back the way it started, so each test reads from the same week. */
  const reset = async () => {
    const db = getPlatformPrisma();
    await db.timetableSlot.deleteMany({ where: { schoolId: s.schoolId, classSectionId: ids.vb, effectiveFrom: { gt: new Date(`${PAST}T00:00:00+05:30`) } } });
    await db.timetableSlot.updateMany({ where: { schoolId: s.schoolId, classSectionId: ids.vb }, data: { effectiveTo: null } });
  };
  beforeEach(reset);

  describe('the preview', () => {
    it('lists the clicked period first, then every English period of V-B held by someone else, with the clash named', async () => {
      const res = await admin().post('/manage/timetable/subject-teacher/preview').send(body({ cell: { dayOfWeek: 5, periodId: ids.p2 } })).expect(200);
      const rows = res.body.rows as { dayOfWeek: number; periodLabel: string; clicked: boolean; current: { teacherName: string } | null; clash: { classLabel: string } | null }[];
      expect(rows.map((r) => `${r.dayOfWeek}${r.periodLabel}`)).toEqual(['5II', '1I', '2I', '3II']);
      expect(rows[0]).toMatchObject({ clicked: true, current: null, clash: null });
      expect(rows.find((r) => r.dayOfWeek === 2)).toMatchObject({ current: { teacherName: 'Krishna Shah' }, clash: { classLabel: 'VII-A' } });
      expect(rows.filter((r) => r.clash).length).toBe(1);
      expect(res.body).toMatchObject({ teacher: { name: 'Rishika Agarwal', active: true }, subject: { name: 'English' }, from: TODAY, until: null, alreadyTheirs: 0, load: { now: 1 } });
    });

    it('a period that already holds Rishika for English is not listed — counted as already hers', async () => {
      await admin().post('/manage/timetable/subject-teacher').send(body({ cells: [{ dayOfWeek: 1, periodId: ids.p1 }] })).expect(201);
      const res = await admin().post('/manage/timetable/subject-teacher/preview').send(body()).expect(200);
      expect(res.body.alreadyTheirs).toBe(1);
      expect(res.body.rows.map((r: { dayOfWeek: number }) => r.dayOfWeek)).toEqual([2, 3]);
    });

    it('warns — without blocking — when Rishika is on approved leave on a day the change covers', async () => {
      await getPlatformPrisma().leaveApplication.create({ data: { schoolId: s.schoolId, teacherId: ids.rishika, type: 'CASUAL', status: 'APPROVED', startDate: new Date(`${NEXT_MON}T00:00:00Z`), endDate: new Date(`${NEXT_MON}T00:00:00Z`) } });
      const res = await admin().post('/manage/timetable/subject-teacher/preview').send(body({ from: NEXT_MON, until: MON_AFTER })).expect(200);
      const monday = res.body.rows.find((r: { dayOfWeek: number }) => r.dayOfWeek === 1);
      expect(monday.warnings.join(' ')).toMatch(/On leave Mon .* will need cover/);
      expect(monday.clash).toBeNull();
    });
  });

  describe('applying', () => {
    it('from now on: the ticked periods move today and stay moved; the past still reads Krishna', async () => {
      const res = await admin().post('/manage/timetable/subject-teacher').send(body({ cells: [{ dayOfWeek: 1, periodId: ids.p1 }, { dayOfWeek: 3, periodId: ids.p2 }] })).expect(201);
      expect(res.body).toMatchObject({ changed: 2, skipped: [], from: TODAY, until: null });
      expect(await who(TODAY, 1, ids.p1)).toBe('English:Rishika');
      expect(await who(TUE_AFTER_NEXT, 3, ids.p2)).toBe('English:Rishika');
      expect(await who(PAST, 1, ids.p1)).toBe('English:Krishna');
      // Not ticked, and other subjects: untouched.
      expect(await who(TODAY, 2, ids.p1)).toBe('English:Krishna');
      expect(await who(TODAY, 4, ids.p1)).toBe('Hindi:Sandeep');
    });

    it('a clash is skipped and reported, never forced — the rest still land', async () => {
      const res = await admin().post('/manage/timetable/subject-teacher').send(body({ cells: [{ dayOfWeek: 1, periodId: ids.p1 }, { dayOfWeek: 2, periodId: ids.p1 }] })).expect(201);
      expect(res.body.changed).toBe(1);
      expect(res.body.skipped).toEqual([{ dayOfWeek: 2, periodId: ids.p1, reason: expect.stringMatching(/Rishika Agarwal teaches VII-A/) }]);
      expect(await who(TODAY, 2, ids.p1)).toBe('English:Krishna');
      expect(await who(TODAY, 2, ids.p1, ids.viia)).toBe('English:Rishika');
    });

    it('this week only: Krishna comes back on the next Monday by himself', async () => {
      await admin().post('/manage/timetable/subject-teacher').send(body({ until: NEXT_MON, cells: [{ dayOfWeek: 1, periodId: ids.p1 }] })).expect(201);
      expect(await who(TODAY, 1, ids.p1)).toBe('English:Rishika');
      expect(await who(NEXT_MON, 1, ids.p1)).toBe('English:Krishna');
      expect(await who(PAST, 1, ids.p1)).toBe('English:Krishna');
    });

    it('a future week only: this week and the week after keep Krishna', async () => {
      await admin().post('/manage/timetable/subject-teacher').send(body({ from: NEXT_MON, until: MON_AFTER, cells: [{ dayOfWeek: 1, periodId: ids.p1 }] })).expect(201);
      expect(await who(TODAY, 1, ids.p1)).toBe('English:Krishna');
      expect(await who(NEXT_MON, 1, ids.p1)).toBe('English:Rishika');
      expect(await who(MON_AFTER, 1, ids.p1)).toBe('English:Krishna');
    });

    it('a past week cannot be rewritten: a `from` before today starts today', async () => {
      const res = await admin().post('/manage/timetable/subject-teacher').send(body({ from: PAST, cells: [{ dayOfWeek: 1, periodId: ids.p1 }] })).expect(201);
      expect(res.body.from).toBe(TODAY);
      expect(await who(PAST, 1, ids.p1)).toBe('English:Krishna');
    });

    it('running it twice changes nothing the second time', async () => {
      const cells = [{ dayOfWeek: 1, periodId: ids.p1 }];
      await admin().post('/manage/timetable/subject-teacher').send(body({ cells })).expect(201);
      const before = await getPlatformPrisma().timetableSlot.count({ where: { classSectionId: ids.vb } });
      await admin().post('/manage/timetable/subject-teacher').send(body({ cells })).expect(201);
      expect(await getPlatformPrisma().timetableSlot.count({ where: { classSectionId: ids.vb } })).toBe(before);
    });

    it('refuses a teacher who has left, and an end before the start', async () => {
      await admin().post('/manage/timetable/subject-teacher').send(body({ teacherId: ids.gone, cells: [{ dayOfWeek: 1, periodId: ids.p1 }] })).expect(400);
      await admin().post('/manage/timetable/subject-teacher').send(body({ from: NEXT_MON, until: NEXT_MON, cells: [{ dayOfWeek: 1, periodId: ids.p1 }] })).expect(400);
      await admin().post('/manage/timetable/subject-teacher').send(body({ cells: [] })).expect(400);
    });

    it('the single-period assign keeps its strict clash: 409 naming the class', async () => {
      const res = await admin().post('/manage/timetable').send({ ...body(), dayOfWeek: 2, periodId: ids.p1 }).expect(409);
      expect(res.body).toMatchObject({ code: 'TEACHER_CONFLICT' });
      expect(res.body.message).toMatch(/VII-A/);
    });
  });

  describe('removing a period', () => {
    it('from a future week on: this week keeps it', async () => {
      const slots = await admin().get(`/manage/timetable?classSectionId=${ids.vb}&date=${TODAY}`).expect(200);
      const mon = slots.body.find((x: { dayOfWeek: number; periodId: string }) => x.dayOfWeek === 1 && x.periodId === ids.p1);
      await admin().del(`/manage/timetable/${mon.id}?from=${NEXT_MON}`).expect(204);
      expect(await who(TODAY, 1, ids.p1)).toBe('English:Krishna');
      expect(await who(NEXT_MON, 1, ids.p1)).toBeNull();
      expect(await who(PAST, 1, ids.p1)).toBe('English:Krishna');
    });
  });

  describe('who may do it', () => {
    it.each(['teacher', 'staff', 'student'])('refuses a %s on both doors', async (w) => {
      await as(tok[w]).post('/manage/timetable/subject-teacher/preview').send(body()).expect(403);
      await as(tok[w]).post('/manage/timetable/subject-teacher').send(body({ cells: [{ dayOfWeek: 1, periodId: ids.p1 }] })).expect(403);
    });
    it('refuses an anonymous caller', async () => {
      await as().post('/manage/timetable/subject-teacher/preview').send(body()).expect(401);
    });
  });
});
