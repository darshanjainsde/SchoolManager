/**
 * The leave desk's races, against real Postgres — the REAL LeaveService and
 * CoverNudgeService, real transactions, real advisory locks. A mock can show
 * that a lock is ASKED for; only two transactions on a real database can show
 * that it holds:
 *
 * (a) the 18:00 nudge fired twice at once (Vercel can) reaches the desk ONCE;
 * (b) two desks giving the same teacher two different gaps of one period at
 *     the same moment: exactly one wins, the other is told which class has
 *     the teacher, and only one cover card goes out.
 *
 * Each part seeds its own school; every assertion is scoped to it.
 */
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { LeaveService } from '../src/modules/management/leave.service';
import { CoverNudgeService } from '../src/modules/management/cover-nudge.service';
import { todayIstDateStr, toDateStr } from '../src/modules/management/internal/leave-dates';

describe('leave desk races on real Postgres', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const schools: string[] = [];
  const db = () => getPlatformPrisma();

  /** A school with one admin on the desk, one class section, one period and one subject. */
  async function seedSchool(tag: string) {
    const p = db();
    const school = await p.school.create({ data: { slug: `cover-race-${tag}-${suffix}`, name: `Cover Race ${tag}`, tier: 'PRO', status: 'LIVE', workingDays: [1, 2, 3, 4, 5, 6, 7] }, select: { id: true } });
    schools.push(school.id);
    const S = school.id;
    const admin = await p.user.create({ data: { schoolId: S, email: `admin-${tag}-${suffix}@race.test`, role: 'SCHOOL_ADMIN', passwordHash: 'not-a-login', name: 'Desk Admin' }, select: { id: true } });
    const year = await p.academicYear.create({ data: { schoolId: S, name: '2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2031-03-31') }, select: { id: true } });
    const grade = await p.grade.create({ data: { schoolId: S, name: '9' }, select: { id: true } });
    const period = await p.period.create({ data: { schoolId: S, order: 1, label: 'Period 1', startTime: '09:00', endTime: '09:45' }, select: { id: true } });
    const subject = await p.subject.create({ data: { schoolId: S, name: 'Maths', code: 'MA' }, select: { id: true } });
    const section = (name: string) => p.classSection.create({ data: { schoolId: S, gradeId: grade.id, name, academicYearId: year.id }, select: { id: true } });
    const teacher = async (first: string) => {
      const u = await p.user.create({ data: { schoolId: S, email: `${first.toLowerCase()}-${tag}-${suffix}@race.test`, role: 'TEACHER', passwordHash: 'not-a-login', name: first }, select: { id: true } });
      const t = await p.teacher.create({ data: { schoolId: S, firstName: first, lastName: 'Test', userId: u.id }, select: { id: true } });
      return { id: t.id, userId: u.id };
    };
    return { S, admin, year, period, subject, section, teacher };
  }

  afterAll(async () => {
    const p = db();
    for (const S of schools) {
      await p.notificationOutbox.deleteMany({ where: { schoolId: S } });
      await p.notification.deleteMany({ where: { schoolId: S } });
      await p.substitution.deleteMany({ where: { schoolId: S } });
      await p.staffAttendance.deleteMany({ where: { schoolId: S } });
      await p.leaveApplication.deleteMany({ where: { schoolId: S } });
      await p.timetableSlot.deleteMany({ where: { schoolId: S } });
      await p.school.delete({ where: { id: S } }).catch(() => undefined);
    }
    await disconnectAll();
  });

  it('(a) the nudge fired twice at once reaches the desk ONCE — and a third run later adds nothing', async () => {
    const { S, admin, period, section, teacher } = await seedSchool('nudge');
    const now = new Date();
    const today = todayIstDateStr(now);
    const tomorrow = toDateStr(new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 3_600_000));
    const cs = await section('A');
    const away = await teacher('Anil');
    // Two open gaps tomorrow (the school works every day, so tomorrow always counts).
    const cs2 = await section('B');
    for (const c of [cs, cs2]) {
      await db().substitution.create({ data: { schoolId: S, classSectionId: c.id, periodId: period.id, date: new Date(tomorrow), originalTeacherId: away.id, reason: 'leave' } });
    }

    const svc = new CoverNudgeService();
    await Promise.all([svc.run(now), svc.run(now)]);
    await svc.run(new Date(now.getTime() + 60_000));

    const rows = await db().notificationOutbox.findMany({ where: { schoolId: S, kind: 'COVER_UNFILLED' }, select: { targetUserId: true, payload: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ targetUserId: admin.id, payload: expect.objectContaining({ gaps: 2, forDate: tomorrow, nudgeFor: tomorrow }) });
    const bells = await db().notification.findMany({ where: { schoolId: S, userId: admin.id }, select: { title: true } });
    expect(bells).toEqual([{ title: '2 periods have no teacher tomorrow' }]);
  });

  it('(b) two desks give one teacher two gaps of the same period at once: exactly one wins, every time', async () => {
    const { S, admin, year, period, subject, section, teacher } = await seedSchool('assign');
    const D = '2030-01-07'; // a Monday, safely in the future
    const [c1, c2] = [await section('A'), await section('B')];
    const anil = await teacher('Anil');
    const bina = await teacher('Bina');
    const xavier = await teacher('Xavier');
    for (const [t, c] of [[anil, c1], [bina, c2]] as const) {
      await db().timetableSlot.create({ data: { schoolId: S, classSectionId: c.id, dayOfWeek: 1, periodId: period.id, subjectId: subject.id, teacherId: t.id, academicYearId: year.id, effectiveFrom: new Date('2026-01-01') } });
    }
    const leave = new LeaveService();
    for (const t of [anil, bina]) {
      const l = await leave.apply(S, t.userId, { type: 'CASUAL', startDate: D, endDate: D });
      await leave.approve(S, l.id, admin.id);
    }
    const gaps = await db().substitution.findMany({ where: { schoolId: S, date: new Date(D) }, select: { id: true, classSectionId: true } });
    expect(gaps).toHaveLength(2);
    const [g1, g2] = gaps;

    const ROUNDS = 10;
    for (let i = 0; i < ROUNDS; i += 1) {
      await db().substitution.updateMany({ where: { schoolId: S, date: new Date(D) }, data: { substituteTeacherId: null, acknowledgedAt: null } });
      const results = await Promise.allSettled([
        leave.assign(S, g1.id, { substituteTeacherId: xavier.id }),
        leave.assign(S, g2.id, { substituteTeacherId: xavier.id }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      const held = await db().substitution.findMany({ where: { schoolId: S, date: new Date(D), substituteTeacherId: xavier.id }, select: { classSectionId: true } });
      expect(held).toHaveLength(1);
      // The loser is told which class got the teacher first.
      const winnerClass = held[0].classSectionId === c1.id ? '9-A' : '9-B';
      expect(lost.reason.response).toMatchObject({ code: 'TEACHER_CONFLICT', message: `Xavier Test is already covering ${winnerClass} in that period. Nothing was changed; pick someone else.` });
    }
    // One cover card per round — never one for the loser.
    expect(await db().notificationOutbox.count({ where: { schoolId: S, kind: 'COVER_ASSIGNED', targetUserId: xavier.userId } })).toBe(ROUNDS);
  });
});
