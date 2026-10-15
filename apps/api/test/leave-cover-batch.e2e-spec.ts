/**
 * "Cover with one teacher" on real Postgres: the real LeaveService, real
 * transactions and advisory locks, and the real HTTP doors.
 *
 * The school: Priya Nair is on leave Mon 7 – Thu 10 Jan 2030 and teaches
 * 9-A P1, 9-B P2 and 9-C P3 every day — twelve gaps. Rahul is the teacher the
 * desk wants to give them to, and he is busy in exactly the ways the drawer
 * must name:
 *   · Mon P2 he teaches 9-D                         → TEACHING
 *   · Wed P3 he covers Kiran's 9-D (another leave)  → COVERING
 *   · Thu he is on leave himself                    → ON_LEAVE ×3
 *   · Tue P1 the desk already gave to Anita         → TAKEN
 * which leaves six periods FREE.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { LeaveService } from '../src/modules/management/leave.service';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

const MON = '2030-01-07';
const TUE = '2030-01-08';
const WED = '2030-01-09';
const THU = '2030-01-10';

describe('cover a leave with one teacher', () => {
  let app: INestApplication;
  const db = () => getPlatformPrisma();
  const leave = new LeaveService();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  /** One school per test that writes, so no test leans on another's leftovers. */
  async function seed(tag: string) {
    const p = db();
    const base = await seedMinimalSchool();
    const S = base.schoolId;
    await p.school.update({ where: { id: S }, data: { workingDays: [1, 2, 3, 4, 5, 6, 7] } });
    const year = await p.academicYear.create({ data: { schoolId: S, name: '2029-30', startDate: new Date('2029-04-01'), endDate: new Date('2031-03-31') }, select: { id: true } });
    const grade = await p.grade.create({ data: { schoolId: S, name: '9' }, select: { id: true } });
    const periods: { id: string }[] = [];
    for (const [i, from, to] of [[1, '09:00', '09:45'], [2, '09:45', '10:30'], [3, '10:45', '11:30']] as const) {
      periods.push(await p.period.create({ data: { schoolId: S, order: i, label: `Period ${i}`, startTime: from, endTime: to }, select: { id: true } }));
    }
    const subject = await p.subject.create({ data: { schoolId: S, name: 'Science', code: `SC${tag}` }, select: { id: true } });
    const cs: Record<string, string> = {};
    for (const n of ['A', 'B', 'C', 'D']) cs[n] = (await p.classSection.create({ data: { schoolId: S, gradeId: grade.id, name: n, academicYearId: year.id }, select: { id: true } })).id;
    const teacher = async (first: string, opts: { active?: boolean } = {}) => {
      const u = await p.user.create({ data: { schoolId: S, email: `${first.toLowerCase()}-${tag}-${suffix}@cover.test`, role: 'TEACHER', passwordHash: 'x', name: first }, select: { id: true } });
      const t = await p.teacher.create({ data: { schoolId: S, firstName: first, lastName: 'Test', userId: u.id, isActive: opts.active ?? true }, select: { id: true } });
      return { id: t.id, userId: u.id };
    };
    const slot = (teacherId: string, section: string, period: number, day: number) =>
      p.timetableSlot.create({ data: { schoolId: S, classSectionId: cs[section], dayOfWeek: day, periodId: periods[period - 1].id, subjectId: subject.id, teacherId, academicYearId: year.id, effectiveFrom: new Date('2029-04-01') } });

    const priya = await teacher('Priya');
    const rahul = await teacher('Rahul');
    const anita = await teacher('Anita');
    const kiran = await teacher('Kiran');
    const gone = await teacher('Gone', { active: false });
    for (let day = 1; day <= 7; day++) {
      await slot(priya.id, 'A', 1, day);
      await slot(priya.id, 'B', 2, day);
      await slot(priya.id, 'C', 3, day);
    }
    await slot(rahul.id, 'D', 2, 1); // Mon P2: Rahul teaches 9-D
    await slot(kiran.id, 'D', 3, 3); // Wed P3: Kiran teaches 9-D

    const admin = base.adminUserId;
    const approveLeave = async (t: { userId: string }, start: string, end: string) => {
      const l = await leave.apply(S, t.userId, { type: 'CASUAL', startDate: start, endDate: end });
      await leave.approve(S, l.id, admin);
      return l.id;
    };
    const kiranLeave = await approveLeave(kiran, WED, WED);
    const kiranGap = await p.substitution.findFirstOrThrow({ where: { schoolId: S, leaveApplicationId: kiranLeave } });
    await leave.assign(S, kiranGap.id, { substituteTeacherId: rahul.id }); // Wed P3: Rahul covers 9-D
    const priyaLeave = await approveLeave(priya, MON, THU);
    await p.staffAttendance.create({ data: { schoolId: S, teacherId: rahul.id, date: new Date(THU), status: 'ON_LEAVE' } });
    const gapAt = async (date: string, period: number) =>
      p.substitution.findFirstOrThrow({ where: { schoolId: S, leaveApplicationId: priyaLeave, date: new Date(date), periodId: periods[period - 1].id } });
    await leave.assign(S, (await gapAt(TUE, 1)).id, { substituteTeacherId: anita.id }); // Tue P1: Anita
    // Only what the batch itself writes is counted below.
    await p.notificationOutbox.deleteMany({ where: { schoolId: S } });
    await p.notification.deleteMany({ where: { schoolId: S } });
    return { S, base, priya, rahul, anita, kiran, gone, priyaLeave, kiranLeave, gapAt, periods, cs };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const http = (host: string, token?: string) => {
    const h: Record<string, string> = { 'X-Skoolos-Host': host };
    if (token) h.Authorization = `Bearer ${token}`;
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(h),
      post: (url: string, body: unknown) => request(app.getHttpServer()).post(url).set(h).send(body as object),
    };
  };

  // ── the doors ──────────────────────────────────────────────────────────

  it('only the leave desk — an admin or an accounts officer — reaches the three routes; everyone else 403, nobody 401', async () => {
    const s = await seed('door');
    const { S, base } = s;
    const accountsUser = await db().user.create({ data: { schoolId: S, email: `accounts-${suffix}@cover.test`, role: 'STAFF', passwordHash: 'x' }, select: { id: true } });
    await db().staff.create({ data: { schoolId: S, firstName: 'Asha', lastName: 'Accounts', role: 'ACCOUNTS', userId: accountsUser.id } });
    const token = (sub: string, role: 'SCHOOL_ADMIN' | 'STAFF' | 'TEACHER' | 'STUDENT') => signSchoolToken({ sub, schoolId: S, role });
    const routes = [
      (c: ReturnType<typeof http>) => c.get(`/manage/leave/${s.priyaLeave}/cover-fit`),
      (c: ReturnType<typeof http>) => c.get(`/manage/leave/${s.priyaLeave}/cover-preview?teacherId=${s.rahul.id}`),
      async (c: ReturnType<typeof http>) => c.post(`/manage/leave/${s.priyaLeave}/cover-batch`, { substituteTeacherId: s.rahul.id, substitutionIds: [(await s.gapAt(MON, 1)).id] }),
    ];
    for (const r of routes) {
      expect((await r(http(base.host))).status).toBe(401);
      for (const [sub, role] of [[base.studentUserId, 'STUDENT'], [base.teacherUserId, 'TEACHER'], [base.staffUserId, 'STAFF']] as const) {
        const res = await r(http(base.host, token(sub, role)));
        expect(res.status).toBe(403);
      }
    }
    // The real payload, not merely "not 403".
    const fit = await http(base.host, token(base.adminUserId, 'SCHOOL_ADMIN')).get(`/manage/leave/${s.priyaLeave}/cover-fit`).expect(200);
    expect(fit.body.open).toBe(11);
    const pre = await http(base.host, token(accountsUser.id, 'STAFF')).get(`/manage/leave/${s.priyaLeave}/cover-preview?teacherId=${s.rahul.id}`).expect(200);
    expect(pre.body.rows).toHaveLength(12);
    const batch = await http(base.host, token(base.adminUserId, 'SCHOOL_ADMIN'))
      .post(`/manage/leave/${s.priyaLeave}/cover-batch`, { substituteTeacherId: s.rahul.id, substitutionIds: [(await s.gapAt(MON, 1)).id] })
      .expect(201);
    expect(batch.body).toMatchObject({ given: 1, skipped: [] });
  });

  it('refuses a bad request in words: not a uuid, no periods, too many, a teacher id that is not one', async () => {
    const s = await seed('valid');
    const admin = http(s.base.host, signSchoolToken({ sub: s.base.adminUserId, schoolId: s.S, role: 'SCHOOL_ADMIN' }));
    await admin.get(`/manage/leave/${s.priyaLeave}/cover-preview`).expect(400);
    await admin.get(`/manage/leave/${s.priyaLeave}/cover-preview?teacherId=nope`).expect(400);
    await admin.get(`/manage/leave/not-a-uuid/cover-fit`).expect(400);
    await admin.post(`/manage/leave/${s.priyaLeave}/cover-batch`, { substituteTeacherId: s.rahul.id, substitutionIds: [] }).expect(400);
    await admin.post(`/manage/leave/${s.priyaLeave}/cover-batch`, { substituteTeacherId: s.rahul.id, substitutionIds: ['x'] }).expect(400);
    const tooMany = Array.from({ length: 601 }, () => s.rahul.id);
    await admin.post(`/manage/leave/${s.priyaLeave}/cover-batch`, { substituteTeacherId: s.rahul.id, substitutionIds: tooMany }).expect(400);
    await admin.post(`/manage/leave/${s.priyaLeave}/cover-batch`, { substitutionIds: [s.rahul.id] }).expect(400);
  });

  // ── the preview ────────────────────────────────────────────────────────

  it('the preview names every period of the leave and exactly why each one cannot go to Rahul', async () => {
    const s = await seed('preview');
    const p = await leave.coverPreview(s.S, s.priyaLeave, s.rahul.id);
    expect(p.leave).toEqual({ id: s.priyaLeave, teacherName: 'Priya Test', dates: 'Mon 7 – Thu 10 Jan 2030' });
    expect(p.teacher).toEqual({ id: s.rahul.id, name: 'Rahul Test' });
    expect(p.rows.map((r) => `${r.date} ${r.periodLabel} ${r.className} ${r.state}${r.reason ? ` — ${r.reason}` : ''}`)).toEqual([
      `${MON} Period 1 9-A FREE`,
      `${MON} Period 2 9-B TEACHING — Rahul Test teaches 9-D then.`,
      `${MON} Period 3 9-C FREE`,
      `${TUE} Period 1 9-A TAKEN — Anita Test already covers it.`,
      `${TUE} Period 2 9-B FREE`,
      `${TUE} Period 3 9-C FREE`,
      `${WED} Period 1 9-A FREE`,
      `${WED} Period 2 9-B FREE`,
      `${WED} Period 3 9-C COVERING — Rahul Test is covering 9-D then.`,
      `${THU} Period 1 9-A ON_LEAVE — Rahul Test is on leave that day.`,
      `${THU} Period 2 9-B ON_LEAVE — Rahul Test is on leave that day.`,
      `${THU} Period 3 9-C ON_LEAVE — Rahul Test is on leave that day.`,
    ]);
    expect(p.rows[0].time).toBe('09:00–09:45');
    // His load before anything is given: the Wednesday cover of Kiran's class.
    expect(p.days).toEqual([
      { date: MON, label: 'Mon 7 Jan', coversBefore: 0 },
      { date: TUE, label: 'Tue 8 Jan', coversBefore: 0 },
      { date: WED, label: 'Wed 9 Jan', coversBefore: 1 },
      { date: THU, label: 'Thu 10 Jan', coversBefore: 0 },
    ]);
    expect(p.busyDayAt).toBe(4);
  });

  it('the preview agrees with the single-period dropdown on every FREE and every refused period', async () => {
    const s = await seed('agree');
    const p = await leave.coverPreview(s.S, s.priyaLeave, s.rahul.id);
    for (const r of p.rows.filter((x) => x.state !== 'TAKEN')) {
      const offered = (await leave.candidates(s.S, r.gapId)).some((c) => c.id === s.rahul.id);
      expect([r.date, r.periodLabel, offered]).toEqual([r.date, r.periodLabel, r.state === 'FREE']);
    }
  });

  it('cover-fit ranks who can take the most, leaves out the teacher on leave and anyone inactive', async () => {
    const s = await seed('fit');
    const fit = await leave.coverFit(s.S, s.priyaLeave);
    expect(fit.open).toBe(11);
    const names = fit.teachers.map((t) => t.name);
    expect(names).not.toContain('Priya Test');
    expect(names).not.toContain('Gone Test');
    expect(fit.teachers.find((t) => t.name === 'Rahul Test')?.free).toBe(6);
    // Anita teaches nothing and holds only Tue P1, which is not open: free for all eleven.
    expect(fit.teachers.find((t) => t.name === 'Anita Test')?.free).toBe(11);
    expect(fit.teachers[0].free).toBeGreaterThanOrEqual(fit.teachers[fit.teachers.length - 1].free);
  });

  // ── the batch ──────────────────────────────────────────────────────────

  it('gives Rahul every FREE period in one go and tells him ONCE — one summary, no per-period cards', async () => {
    const s = await seed('batch');
    const pre = await leave.coverPreview(s.S, s.priyaLeave, s.rahul.id);
    const free = pre.rows.filter((r) => r.state === 'FREE').map((r) => r.gapId);
    const r = await leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: free });
    expect(r).toEqual({ given: 6, alreadyTheirs: 0, skipped: [], stillOpen: 5 });
    expect(await db().substitution.count({ where: { schoolId: s.S, leaveApplicationId: s.priyaLeave, substituteTeacherId: s.rahul.id } })).toBe(6);

    const out = await db().notificationOutbox.findMany({ where: { schoolId: s.S, targetUserId: s.rahul.userId }, select: { kind: true, payload: true } });
    expect(out).toEqual([{ kind: 'COVER_BATCH', payload: { schoolName: expect.any(String), leaveId: s.priyaLeave, substituteTeacherId: s.rahul.id, count: 6, dates: 'Mon 7 – Wed 9 Jan 2030', originalTeacherName: 'Priya Test' } }]);
    const bells = await db().notification.findMany({ where: { schoolId: s.S, userId: s.rahul.userId }, select: { title: true, body: true } });
    expect(bells).toEqual([{ title: 'You cover 6 periods for Priya Test', body: 'Mon 7 – Wed 9 Jan 2030' }]);
  });

  it('a batch of ONE sends the ordinary cover card, not a summary', async () => {
    const s = await seed('one');
    await leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: [(await s.gapAt(MON, 1)).id] });
    const out = await db().notificationOutbox.findMany({ where: { schoolId: s.S, targetUserId: s.rahul.userId }, select: { kind: true } });
    expect(out).toEqual([{ kind: 'COVER_ASSIGNED' }]);
  });

  it('never forces: what changed since the drawer opened is skipped and named, and the rest still go', async () => {
    const s = await seed('skip');
    const pre = await leave.coverPreview(s.S, s.priyaLeave, s.rahul.id);
    const free = pre.rows.filter((r) => r.state === 'FREE').map((r) => r.gapId);
    // Meanwhile another desk gives Wed P1 to Anita…
    const wedP1 = await s.gapAt(WED, 1);
    await leave.assign(s.S, wedP1.id, { substituteTeacherId: s.anita.id });
    // …and the drawer also sends a period Rahul was never free for, a gap of
    // another leave, a gap that no longer exists, and one from the past.
    const monP2 = await s.gapAt(MON, 2);
    const kiranGap = await db().substitution.findFirstOrThrow({ where: { schoolId: s.S, leaveApplicationId: s.kiranLeave } });
    const past = await db().substitution.create({ data: { schoolId: s.S, classSectionId: s.cs.D, periodId: s.periods[0].id, date: new Date('2026-01-05'), originalTeacherId: s.priya.id, reason: 'leave', leaveApplicationId: s.priyaLeave } });
    const ghost = '99999999-9999-4999-8999-999999999999';
    const r = await leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: [...free, monP2.id, kiranGap.id, ghost, past.id] });

    expect(r.given).toBe(5);
    expect(r.skipped.map((k) => [k.why, k.when, k.className, k.reason])).toEqual([
      ['GONE', '', '', 'This period no longer needs cover.'],
      ['PAST', 'Mon 5 Jan, Period 1', '9-D', 'This day has already gone.'],
      ['TEACHING', 'Mon 7 Jan, Period 2', '9-B', 'Rahul Test teaches 9-D then.'],
      ['TAKEN', 'Wed 9 Jan, Period 1', '9-A', 'Anita Test already covers it.'],
      ['NOT_THIS_LEAVE', 'Wed 9 Jan, Period 3', '9-D', 'This period belongs to a different leave.'],
    ]);
    // Nothing that was skipped changed hands.
    expect((await db().substitution.findUniqueOrThrow({ where: { id: wedP1.id } })).substituteTeacherId).toBe(s.anita.id);
    expect((await db().substitution.findUniqueOrThrow({ where: { id: monP2.id } })).substituteTeacherId).toBeNull();
    expect((await db().substitution.findUniqueOrThrow({ where: { id: past.id } })).substituteTeacherId).toBeNull();
  });

  it('periods already his are counted, not given twice, and do not send a second card', async () => {
    const s = await seed('theirs');
    const monP1 = await s.gapAt(MON, 1);
    await leave.assign(s.S, monP1.id, { substituteTeacherId: s.rahul.id });
    await db().notificationOutbox.deleteMany({ where: { schoolId: s.S } });
    const r = await leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: [monP1.id] });
    expect(r).toMatchObject({ given: 0, alreadyTheirs: 1, skipped: [] });
    expect(await db().notificationOutbox.count({ where: { schoolId: s.S } })).toBe(0);
    // The summary after a later batch counts the first pick too.
    const rest = (await leave.coverPreview(s.S, s.priyaLeave, s.rahul.id)).rows.filter((x) => x.state === 'FREE').map((x) => x.gapId);
    await leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: rest });
    const sum = await db().notificationOutbox.findFirstOrThrow({ where: { schoolId: s.S, kind: 'COVER_BATCH' }, select: { payload: true } });
    expect(sum.payload).toMatchObject({ count: 6 });
  });

  it('refuses the wrong teacher or leave outright, changing nothing', async () => {
    const s = await seed('refuse');
    const ids = [(await s.gapAt(MON, 1)).id];
    const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { response?: { code?: string }; status?: number }) => e.response?.code ?? String(e.status));
    expect(await code(leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.priya.id, substitutionIds: ids }))).toBe('VALIDATION');
    expect(await code(leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.gone.id, substitutionIds: ids }))).toBe('VALIDATION');
    expect(await code(leave.coverPreview(s.S, s.priyaLeave, s.priya.id))).toBe('VALIDATION');
    // Another school's leave and another school's teacher are simply not found.
    const other = await seed('refuse-other');
    expect(await code(leave.coverBatch(s.S, other.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: ids }))).toBe('404');
    expect(await code(leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: other.rahul.id, substitutionIds: ids }))).toBe('404');
    expect(await code(leave.coverFit(s.S, other.priyaLeave))).toBe('404');
    // A withdrawn leave: its periods need nobody.
    await leave.cancel(s.S, s.priyaLeave, s.base.adminUserId, 'SCHOOL_ADMIN');
    expect(await code(leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: ids }))).toBe('COVER_GONE');
    expect(await code(leave.coverPreview(s.S, s.priyaLeave, s.rahul.id))).toBe('COVER_GONE');
    expect(await db().substitution.count({ where: { schoolId: s.S, substituteTeacherId: s.rahul.id, leaveApplicationId: s.priyaLeave } })).toBe(0);
  });

  it('two desks giving the same leave to two teachers at once: every period ends with exactly one, every time', async () => {
    const s = await seed('race-two');
    for (let round = 0; round < 5; round++) {
      await db().substitution.updateMany({ where: { schoolId: s.S, leaveApplicationId: s.priyaLeave, NOT: { substituteTeacherId: s.anita.id } }, data: { substituteTeacherId: null } });
      const kiranFree = (await leave.coverPreview(s.S, s.priyaLeave, s.kiran.id)).rows.filter((r) => r.state === 'FREE').map((r) => r.gapId);
      const rahulFree = (await leave.coverPreview(s.S, s.priyaLeave, s.rahul.id)).rows.filter((r) => r.state === 'FREE').map((r) => r.gapId);
      const [a, b] = await Promise.all([
        leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: rahulFree }),
        leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.kiran.id, substitutionIds: kiranFree }),
      ]);
      const shared = rahulFree.filter((id) => kiranFree.includes(id)).length;
      // Every shared period went to exactly one of them; the other was told it was taken.
      expect(a.given + b.given).toBe(rahulFree.length + kiranFree.length - shared);
      expect([...a.skipped, ...b.skipped].every((k) => k.why === 'TAKEN')).toBe(true);
    }
  });

  it('one teacher, two leaves, the same period, two desks at once: never in two rooms', async () => {
    const s = await seed('race-room');
    // A second leave whose gap sits on Mon P1, the same period as Priya's 9-A gap.
    const sana = await db().teacher.create({ data: { schoolId: s.S, firstName: 'Sana', lastName: 'Test' }, select: { id: true } });
    const sanaUser = await db().user.create({ data: { schoolId: s.S, email: `sana-${suffix}@cover.test`, role: 'TEACHER', passwordHash: 'x' }, select: { id: true } });
    await db().teacher.update({ where: { id: sana.id }, data: { userId: sanaUser.id } });
    const year = await db().academicYear.findFirstOrThrow({ where: { schoolId: s.S, name: '2029-30' } });
    const subject = await db().subject.findFirstOrThrow({ where: { schoolId: s.S } });
    await db().timetableSlot.create({ data: { schoolId: s.S, classSectionId: s.cs.D, dayOfWeek: 1, periodId: s.periods[0].id, subjectId: subject.id, teacherId: sana.id, academicYearId: year.id, effectiveFrom: new Date('2029-04-01') } });
    const l = await leave.apply(s.S, sanaUser.id, { type: 'CASUAL', startDate: MON, endDate: MON });
    await leave.approve(s.S, l.id, s.base.adminUserId);
    const sanaGap = await db().substitution.findFirstOrThrow({ where: { schoolId: s.S, leaveApplicationId: l.id } });
    const priyaMonP1 = await s.gapAt(MON, 1);
    for (let round = 0; round < 8; round++) {
      await db().substitution.updateMany({ where: { id: { in: [sanaGap.id, priyaMonP1.id] } }, data: { substituteTeacherId: null } });
      await Promise.allSettled([
        leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: [priyaMonP1.id] }),
        leave.coverBatch(s.S, l.id, { substituteTeacherId: s.rahul.id, substitutionIds: [sanaGap.id] }),
      ]);
      expect(await db().substitution.count({ where: { id: { in: [sanaGap.id, priyaMonP1.id] }, substituteTeacherId: s.rahul.id } })).toBe(1);
    }
  });

  // ── the substitute answers the summary ─────────────────────────────────

  it('Got it marks every period of that leave he holds as seen; Can\'t hands them all back and tells the desk once', async () => {
    const s = await seed('answer');
    const free = (await leave.coverPreview(s.S, s.priyaLeave, s.rahul.id)).rows.filter((r) => r.state === 'FREE').map((r) => r.gapId);
    await leave.coverBatch(s.S, s.priyaLeave, { substituteTeacherId: s.rahul.id, substitutionIds: free });

    expect(await leave.acknowledgeLeave(s.S, s.priyaLeave, s.rahul.userId)).toEqual({ acknowledged: 6 });
    expect(await db().substitution.count({ where: { schoolId: s.S, leaveApplicationId: s.priyaLeave, substituteTeacherId: s.rahul.id, acknowledgedAt: null } })).toBe(0);
    // A second tap is harmless; his cover of KIRAN's leave was never touched.
    expect(await leave.acknowledgeLeave(s.S, s.priyaLeave, s.rahul.userId)).toEqual({ acknowledged: 0 });
    expect((await db().substitution.findFirstOrThrow({ where: { schoolId: s.S, leaveApplicationId: s.kiranLeave } })).acknowledgedAt).toBeNull();

    // Someone who holds none of it cannot answer for it.
    await expect(leave.acknowledgeLeave(s.S, s.priyaLeave, s.kiran.userId)).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' } });
    await expect(leave.declineLeave(s.S, s.priyaLeave, s.kiran.userId)).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' } });

    await db().notificationOutbox.deleteMany({ where: { schoolId: s.S } });
    expect(await leave.declineLeave(s.S, s.priyaLeave, s.rahul.userId)).toEqual({ declined: 6 });
    expect(await db().substitution.count({ where: { schoolId: s.S, leaveApplicationId: s.priyaLeave, substituteTeacherId: s.rahul.id } })).toBe(0);
    // Anita's period and Rahul's cover of Kiran's class stay exactly as they were.
    expect((await s.gapAt(TUE, 1)).substituteTeacherId).toBe(s.anita.id);
    expect((await db().substitution.findFirstOrThrow({ where: { schoolId: s.S, leaveApplicationId: s.kiranLeave } })).substituteTeacherId).toBe(s.rahul.id);
    const desk = await db().notificationOutbox.findMany({ where: { schoolId: s.S, kind: 'COVER_UNFILLED' }, select: { targetUserId: true, payload: true } });
    expect(desk).toEqual([{ targetUserId: s.base.adminUserId, payload: expect.objectContaining({ gaps: 6, forDate: MON, note: "Rahul Test can't take 6 periods of Priya Test's leave." }) }]);
    // Nothing left to decline.
    await expect(leave.declineLeave(s.S, s.priyaLeave, s.rahul.userId)).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' } });
  });

  it('the coverage list carries the leave each gap belongs to, so the console can group by it', async () => {
    const s = await seed('group');
    const rows = await leave.coverage(s.S, MON, THU);
    expect(new Set(rows.map((r) => r.leaveApplicationId))).toEqual(new Set([s.priyaLeave, s.kiranLeave]));
  });
});
