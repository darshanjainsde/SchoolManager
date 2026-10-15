import { coverPlans } from './cover-plan';
import { freeTeachersFor, type CoverGap } from './free-teachers';

/**
 * "Give Rahul the rest of the leave" must never offer a period the single
 * pick would refuse, or refuse one it would offer. Both questions are asked
 * here of ONE in-memory school that answers Prisma's where-clauses for real,
 * across a few hundred random schools — so a rule added to one function and
 * not the other fails this file, whatever the rule is.
 */
const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

type Row = Record<string, unknown>;

/** Just enough of Prisma's where semantics for the two functions under test. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (k === 'NOT') return !matches(row, cond as Row);
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown; lte?: Date; gt?: Date };
      const t = (x: unknown) => (x instanceof Date ? x.getTime() : x);
      if ('in' in c && !c.in!.map(t).includes(t(v))) return false;
      if ('not' in c && (c.not === null ? v === null || v === undefined : t(v) === t(c.not))) return false;
      if ('lte' in c && !(v instanceof Date && v.getTime() <= c.lte!.getTime())) return false;
      if ('gt' in c && !(v instanceof Date && v.getTime() > c.gt!.getTime())) return false;
      return true;
    }
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    return v === cond;
  });
}

function fakeDb(data: { teachers: Row[]; slots: Row[]; subs: Row[]; attendance: Row[] }) {
  const table = (rows: Row[]) => ({
    findMany: async ({ where, distinct }: { where: Row; distinct?: string[] }) => {
      const out = rows.filter((r) => matches(r, where));
      if (!distinct) return out;
      const seen = new Set<string>();
      return out.filter((r) => {
        const k = distinct.map((d) => String(r[d])).join('|');
        return seen.has(k) ? false : (seen.add(k), true);
      });
    },
    findFirst: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    groupBy: async ({ where }: { where: Row }) => {
      const counts = new Map<string, number>();
      for (const r of rows.filter((x) => matches(x, where))) counts.set(r.substituteTeacherId as string, (counts.get(r.substituteTeacherId as string) ?? 0) + 1);
      return [...counts].map(([substituteTeacherId, n]) => ({ substituteTeacherId, _count: { _all: n } }));
    },
  });
  return { teacher: table(data.teachers), timetableSlot: table(data.slots), substitution: table(data.subs), staffAttendance: table(data.attendance) };
}

/** A small seeded generator, so a failure names a reproducible seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomSchool(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const teacherIds = Array.from({ length: 8 }, (_, i) => `t${i}`);
  const periods = ['p1', 'p2', 'p3'];
  const sections = ['cs-a', 'cs-b', 'cs-c', 'cs-d'];
  const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']; // Mon–Thu
  const versions = [new Date('2026-04-01T00:00:00+05:30'), new Date('2026-10-13T00:00:00+05:30'), new Date('2026-10-14T00:00:00+05:30')];
  const teachers = teacherIds.map((id) => ({ id, schoolId: SCHOOL, isActive: r() > 0.12, firstName: id, lastName: 'K' }));
  const slots: Row[] = [];
  for (let i = 0; i < 40; i++) {
    const from = pick(versions);
    const to = r() < 0.3 ? pick(versions) : null;
    slots.push({ schoolId: SCHOOL, teacherId: pick(teacherIds), classSectionId: pick(sections), periodId: pick(periods), dayOfWeek: 1 + Math.floor(r() * 4), subjectId: pick(['ma', 'sc']), effectiveFrom: from, effectiveTo: to && to > from ? to : null });
  }
  const original = pick(teacherIds);
  const gaps: CoverGap[] = [];
  const subs: Row[] = [];
  let n = 0;
  for (const d of dates) {
    for (const p of periods) {
      if (r() < 0.55) {
        const g = { id: `g${n++}`, date: new Date(d), periodId: p, classSectionId: pick(sections), originalTeacherId: original };
        gaps.push(g);
        subs.push({ ...g, schoolId: SCHOOL, substituteTeacherId: r() < 0.3 ? pick(teacherIds) : null });
      }
      // Covers of OTHER leaves on the same days.
      if (r() < 0.4) subs.push({ id: `o${n++}`, schoolId: SCHOOL, date: new Date(d), periodId: p, classSectionId: pick(sections), originalTeacherId: 'someone', substituteTeacherId: pick(teacherIds) });
    }
  }
  const attendance = dates.flatMap((d) => (r() < 0.5 ? [{ schoolId: SCHOOL, teacherId: pick(teacherIds), date: new Date(d), status: r() < 0.7 ? 'ON_LEAVE' : 'PRESENT' }] : []));
  return { db: fakeDb({ teachers, slots, subs, attendance }), teacherIds, gaps, subs };
}

describe('coverPlans — the batch form of freeTeachersFor', () => {
  it('agrees with freeTeachersFor on every teacher, every gap, across 300 random schools', async () => {
    let compared = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { db, teacherIds, gaps } = randomSchool(seed);
      const plans = await coverPlans(db as never, SCHOOL, teacherIds, gaps);
      for (const g of gaps) {
        const single = new Set((await freeTeachersFor(db as never, SCHOOL, g)).map((c) => c.id));
        const batch = new Set(teacherIds.filter((t) => plans.standing(t, g.id).status === 'FREE'));
        if ([...single].sort().join() !== [...batch].sort().join()) {
          throw new Error(`seed ${seed}, gap ${g.id}: freeTeachersFor says [${[...single].sort()}], coverPlans says [${[...batch].sort()}]`);
        }
        compared++;
      }
    }
    // The comparison really ran, over a meaningful number of gaps.
    expect(compared).toBeGreaterThan(1000);
  });

  it('counts the covers a teacher already holds that day, the same as the dropdown does', async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { db, teacherIds, gaps } = randomSchool(seed);
      const plans = await coverPlans(db as never, SCHOOL, teacherIds, gaps);
      for (const g of gaps) {
        for (const c of await freeTeachersFor(db as never, SCHOOL, g)) {
          expect(plans.coversOn(c.id, g.date.toISOString().slice(0, 10))).toBe(c.coversThatDay);
        }
      }
    }
  });

  const gap = (id: string, date: string, periodId: string): CoverGap => ({ id, date: new Date(date), periodId, classSectionId: 'cs-9a', originalTeacherId: 't-priya' });

  it('says WHY a teacher is not free, naming the class they are in', async () => {
    const db = fakeDb({
      teachers: [{ id: 't-rahul', schoolId: SCHOOL, isActive: true }, { id: 't-gone', schoolId: SCHOOL, isActive: false }, { id: 't-priya', schoolId: SCHOOL, isActive: true }],
      slots: [{ schoolId: SCHOOL, teacherId: 't-rahul', periodId: 'p1', dayOfWeek: 1, classSectionId: 'cs-10b', effectiveFrom: new Date('2026-04-01'), effectiveTo: null }],
      subs: [{ id: 'other', schoolId: SCHOOL, date: new Date('2026-10-13'), periodId: 'p2', classSectionId: 'cs-7c', substituteTeacherId: 't-rahul' }],
      attendance: [{ schoolId: SCHOOL, teacherId: 't-rahul', date: new Date('2026-10-14'), status: 'ON_LEAVE' }],
    });
    const gaps = [gap('mon-p1', '2026-10-12', 'p1'), gap('tue-p2', '2026-10-13', 'p2'), gap('wed-p1', '2026-10-14', 'p1'), gap('thu-p1', '2026-10-15', 'p1')];
    const plans = await coverPlans(db as never, SCHOOL, ['t-rahul', 't-gone', 't-priya'], gaps);
    expect(plans.standing('t-rahul', 'mon-p1')).toEqual({ status: 'TEACHING', classSectionId: 'cs-10b' });
    expect(plans.standing('t-rahul', 'tue-p2')).toEqual({ status: 'COVERING', classSectionId: 'cs-7c' });
    // Wednesday: his Monday slot does not apply, but he is on leave that day.
    expect(plans.standing('t-rahul', 'wed-p1')).toEqual({ status: 'ON_LEAVE' });
    expect(plans.standing('t-rahul', 'thu-p1')).toEqual({ status: 'FREE' });
    expect(plans.standing('t-gone', 'thu-p1')).toEqual({ status: 'INACTIVE' });
    expect(plans.standing('t-priya', 'thu-p1')).toEqual({ status: 'ORIGINAL' });
    // A teacher no row in the school knows is never offered.
    const none = await coverPlans(db as never, SCHOOL, ['t-nobody'], gaps);
    expect(none.standing('t-nobody', 'thu-p1')).toEqual({ status: 'INACTIVE' });
  });

  it('a gap already given to this teacher is not "covering elsewhere" — it is theirs', async () => {
    const g = gap('mine', '2026-10-15', 'p1');
    const db = fakeDb({
      teachers: [{ id: 't-rahul', schoolId: SCHOOL, isActive: true }],
      slots: [],
      subs: [{ ...g, schoolId: SCHOOL, substituteTeacherId: 't-rahul' }],
      attendance: [],
    });
    expect((await coverPlans(db as never, SCHOOL, ['t-rahul'], [g])).standing('t-rahul', 'mine')).toEqual({ status: 'FREE' });
  });

  it('judges a slot live by the IST day: a timetable version that ends ON that day no longer counts', async () => {
    const g = gap('thu', '2026-10-15', 'p1');
    const slot = { schoolId: SCHOOL, teacherId: 't-rahul', periodId: 'p1', dayOfWeek: 4, classSectionId: 'cs-6a' };
    const at = (from: string, to: string | null) =>
      coverPlans(fakeDb({ teachers: [{ id: 't-rahul', schoolId: SCHOOL, isActive: true }], slots: [{ ...slot, effectiveFrom: new Date(from), effectiveTo: to ? new Date(to) : null }], subs: [], attendance: [] }) as never, SCHOOL, ['t-rahul'], [g]);
    expect((await at('2026-10-15T00:00:00+05:30', null)).standing('t-rahul', 'thu').status).toBe('TEACHING'); // starts that very day
    expect((await at('2026-10-16T00:00:00+05:30', null)).standing('t-rahul', 'thu').status).toBe('FREE'); // starts the day after
    expect((await at('2026-04-01T00:00:00+05:30', '2026-10-15T00:00:00+05:30')).standing('t-rahul', 'thu').status).toBe('FREE'); // ended that morning
    expect((await at('2026-04-01T00:00:00+05:30', '2026-10-16T00:00:00+05:30')).standing('t-rahul', 'thu').status).toBe('TEACHING');
  });

  it('asks the database four questions however many gaps and teachers there are, and none for an empty plan', async () => {
    const db = fakeDb({ teachers: [], slots: [], subs: [], attendance: [] });
    const spies = [jest.spyOn(db.teacher, 'findMany'), jest.spyOn(db.timetableSlot, 'findMany'), jest.spyOn(db.substitution, 'findMany'), jest.spyOn(db.staffAttendance, 'findMany')];
    const many = Array.from({ length: 200 }, (_, i) => gap(`g${i}`, `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, `p${i % 8}`));
    await coverPlans(db as never, SCHOOL, Array.from({ length: 60 }, (_, i) => `t${i}`), many);
    expect(spies.map((s) => s.mock.calls.length)).toEqual([1, 1, 1, 1]);
    for (const s of spies) expect((s.mock.calls[0][0] as unknown as { where: { schoolId: string } }).where.schoolId).toBe(SCHOOL);
    for (const s of spies) expect((s.mock.calls[0][0] as unknown as { take: number }).take).toBeGreaterThan(0);
    spies.forEach((s) => s.mockClear());
    await coverPlans(db as never, SCHOOL, [], many);
    await coverPlans(db as never, SCHOOL, ['t1'], []);
    expect(spies.every((s) => s.mock.calls.length === 0)).toBe(true);
  });

  it('refuses a question about a gap it was not given, rather than answering FREE', async () => {
    const plans = await coverPlans(fakeDb({ teachers: [], slots: [], subs: [], attendance: [] }) as never, SCHOOL, ['t1'], [gap('a', '2026-10-15', 'p1')]);
    expect(() => plans.standing('t1', 'not-in-plan')).toThrow(/not part of the plan/);
  });
});
