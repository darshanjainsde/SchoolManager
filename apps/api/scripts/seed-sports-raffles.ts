/**
 * Seed the Sports wing on a STAGING school with good data, using the school's
 * EXISTING students: classes tidied (numbered order, a second section for
 * classes 6–12, a date of birth and gender on every child), four houses, the
 * settings, a sports teacher login, a Book of Records with history, a
 * finished meet from last season, a live meet with results half in, a pending
 * record attempt, and the website switch on with a pinned homepage.
 *
 * Idempotent: every run wipes this school's sports data first (tournaments,
 * records, attempts, houses, points) and rebuilds it. Never run this against
 * production — the workflow refuses.
 *
 *   DATABASE_URL=… SEED_SCHOOL_SLUG=raffles pnpm --filter @skoolos/api exec tsx scripts/seed-sports-raffles.ts
 *
 * Deliberately a plain PrismaClient with an explicit URL — the repo's
 * `loadEnv()` would read the local .env over the exported URL (see the
 * staging memory note), and the script must never touch the wrong database.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { hash } from 'argon2';
import {
  buildDraw, drawPlacings, nextSlot, placingPoints, rankMarks, resolveSport, shuffle, stdOfGrade, sportByKey,
  type Sport,
} from '@skoolos/types';
import { buildEventPlan, classLabel, drawToMatches, scheduleHeats, scheduleMatches, seedOf, type EntryIn, type HeatPlan, type MatchPlan } from '../src/modules/sports/internal/sports-build';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
if (/prod|oljrqinbjhpysgfwmtxw/i.test(url)) throw new Error('Refusing to seed what looks like production');
const SLUG = process.env.SEED_SCHOOL_SLUG ?? 'raffles';
const db = new PrismaClient({ datasources: { db: { url } } });

// ── deterministic randomness ──
let seed = 20260910;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const between = (lo: number, hi: number, precision = 2) => Number((lo + rnd() * (hi - lo)).toFixed(precision));
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

type Played = MatchPlan & { scoreA?: number[]; scoreB?: number[] };
interface Kid { id: string; firstName: string; lastName: string; std: number; section: string; gender: string | null; dob: Date | null; houseId: string | null; userId: string | null }

const DAY = 86_400_000;
const todayIst = () => { const d = new Date(Date.now() + 5.5 * 3_600_000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Realistic mark ranges per sport (school level), [worst, best]. */
const RANGE: Record<string, [number, number]> = {
  'ath-100m': [14.6, 11.9], 'ath-200m': [31, 24.5], 'ath-400m': [78, 56], 'ath-800m': [200, 148], 'ath-1500m': [420, 300],
  'ath-long-jump': [3.1, 5.3], 'ath-high-jump': [1.05, 1.55], 'ath-shot-put': [5.5, 11.6], 'ath-discus': [14, 31], 'ath-javelin': [14, 33],
  'swim-50-free': [46, 30.5], 'swim-50-back': [52, 35], 'swim-100-free': [100, 66],
};
const girlsFactor: Record<string, number> = { 'ath-100m': 1.1, 'ath-200m': 1.1, 'ath-400m': 1.12, 'ath-800m': 1.1, 'ath-long-jump': 0.85, 'ath-high-jump': 0.88, 'ath-shot-put': 0.7, 'ath-discus': 0.7, 'ath-javelin': 0.7, 'swim-50-free': 1.08 };
function markFor(sport: Sport, category: string, quality: number): number {
  const [worst, best] = RANGE[sport.key] ?? [10, 20];
  const f = category === 'Girls' ? girlsFactor[sport.key] ?? 1 : 1;
  const raw = worst + (best - worst) * Math.min(1, Math.max(0, quality));
  const s = sport.scoring;
  return Number((raw * (s.type === 'MARK' && s.unit === 's' ? f : 1) * (s.type === 'MARK' && s.unit === 'm' ? f : 1)).toFixed(2));
}

async function main() {
  const school = await db.school.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!school) throw new Error(`No school with slug ${SLUG}`);
  const schoolId = school.id;
  console.log(`Seeding sports for ${school.name} (${SLUG})`);

  // 1. the feature
  await db.featureOverride.upsert({ where: { schoolId_featureKey: { schoolId, featureKey: 'SPORTS' } }, update: { enabled: true }, create: { schoolId, featureKey: 'SPORTS', enabled: true } });

  // 2. classes: numbered order, a second section for classes 6–12, dob + gender on every child
  const year = (await db.academicYear.findFirst({ where: { schoolId, isCurrent: true } })) ?? (await db.academicYear.findFirst({ where: { schoolId }, orderBy: { startDate: 'desc' } }));
  if (!year) throw new Error('The school has no academic year');
  const grades = await db.grade.findMany({ where: { schoolId } });
  const stdOf = new Map<string, number | null>();
  for (const g of grades) {
    const name = g.name.toLowerCase();
    const std = /nursery|pre/.test(name) ? -2 : /lkg/.test(name) ? -1 : /ukg/.test(name) ? 0 : stdOfGrade({ name: g.name, order: null });
    stdOf.set(g.id, std != null && std > 0 ? std : null);
    if (std != null && g.order !== std) await db.grade.update({ where: { id: g.id }, data: { order: std } });
  }
  const sections = await db.classSection.findMany({ where: { schoolId, academicYearId: year.id }, select: { id: true, gradeId: true, name: true } });
  let split = 0;
  for (const g of grades) {
    const std = stdOf.get(g.id);
    if (std == null || std < 6) continue;
    const mine = sections.filter((s) => s.gradeId === g.id);
    if (mine.length >= 2) continue;
    const a = mine[0];
    if (!a) continue;
    const b = await db.classSection.create({ data: { schoolId, gradeId: g.id, name: 'B', academicYearId: year.id }, select: { id: true } });
    sections.push({ id: b.id, gradeId: g.id, name: 'B' });
    const kids = await db.student.findMany({ where: { schoolId, classSectionId: a.id, status: 'ACTIVE' }, orderBy: { admissionNo: 'asc' }, select: { id: true } });
    const moving = kids.slice(Math.ceil(kids.length / 2)).map((k) => k.id);
    if (moving.length) { await db.student.updateMany({ where: { id: { in: moving } }, data: { classSectionId: b.id } }); split += moving.length; }
  }
  const raw = await db.student.findMany({
    where: { schoolId, status: 'ACTIVE', classSectionId: { not: null } }, orderBy: { admissionNo: 'asc' },
    select: { id: true, firstName: true, lastName: true, gender: true, dob: true, houseId: true, userId: true, classSection: { select: { name: true, gradeId: true } } },
  });
  const kids: Kid[] = [];
  let fixed = 0;
  for (const [i, s] of raw.entries()) {
    const std = s.classSection ? stdOf.get(s.classSection.gradeId) : null;
    if (std == null || !s.classSection) continue;
    let gender = s.gender;
    let dob = s.dob;
    if (!gender || !/^(m|f|male|female|boy|girl)/i.test(gender)) gender = i % 2 ? 'F' : 'M';
    if (!dob) dob = new Date(Date.UTC(todayIst().getUTCFullYear() - (std + 5), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)));
    if (gender !== s.gender || dob !== s.dob) { await db.student.update({ where: { id: s.id }, data: { gender, dob } }); fixed++; }
    kids.push({ id: s.id, firstName: s.firstName, lastName: s.lastName, std, section: s.classSection.name, gender, dob, houseId: null, userId: s.userId });
  }
  console.log(`classes: ${grades.length} grades ordered, ${split} students moved into new B sections, ${fixed} children given a dob/gender; ${kids.length} children in numbered classes`);

  // 3. wipe previous sports data
  await db.sportsTournament.deleteMany({ where: { schoolId } });
  await db.sportsRecordAttempt.deleteMany({ where: { schoolId } });
  await db.sportsRecord.deleteMany({ where: { schoolId } });
  await db.housePoint.deleteMany({ where: { schoolId } });
  await db.student.updateMany({ where: { schoolId }, data: { houseId: null } });
  await db.house.deleteMany({ where: { schoolId } });

  // 4. settings + houses
  await db.sportsSettings.upsert({
    where: { schoolId },
    update: { grouping: 'BANDS', bands: [{ id: 'sub', label: 'Sub-junior', stds: [1, 2, 3, 4, 5] }, { id: 'jun', label: 'Junior', stds: [6, 7, 8] }, { id: 'sen', label: 'Senior', stds: [9, 10, 11, 12] }] },
    create: { schoolId, grouping: 'BANDS', bands: [{ id: 'sub', label: 'Sub-junior', stds: [1, 2, 3, 4, 5] }, { id: 'jun', label: 'Junior', stds: [6, 7, 8] }, { id: 'sen', label: 'Senior', stds: [9, 10, 11, 12] }] },
  });
  const houseRows = await Promise.all([['Red', '#DC2626'], ['Blue', '#2563EB'], ['Green', '#059669'], ['Gold', '#D97706']].map(([name, color], order) => db.house.create({ data: { schoolId, name, color, order }, select: { id: true, name: true } })));
  for (const [i, k] of kids.entries()) { k.houseId = houseRows[i % 4].id; }
  for (const h of houseRows) await db.student.updateMany({ where: { id: { in: kids.filter((k) => k.houseId === h.id).map((k) => k.id) } }, data: { houseId: h.id } });
  const houseOf = (side: string | null) => (side?.startsWith('s:') ? kids.find((k) => k.id === side.slice(2))?.houseId ?? null : null);

  // 5. the sports teacher
  const coachEmail = `coach@${SLUG}.test`;
  let coachUser = await db.user.findFirst({ where: { schoolId, email: coachEmail } });
  if (!coachUser) coachUser = await db.user.create({ data: { schoolId, email: coachEmail, username: 'coach', passwordHash: await hash('password'), role: 'STAFF' } });
  const coach = await db.staff.findFirst({ where: { schoolId, userId: coachUser.id } });
  if (!coach) await db.staff.create({ data: { schoolId, firstName: 'Ravi', lastName: 'Kumar', role: 'SPORTS', email: coachEmail, userId: coachUser.id, sportsPerms: ['ENTER', 'VERIFY', 'CREATE', 'PUBLISH', 'HOUSES'] } });
  else await db.staff.update({ where: { id: coach.id }, data: { role: 'SPORTS', isActive: true, status: 'ACTIVE', sportsPerms: ['ENTER', 'VERIFY', 'CREATE', 'PUBLISH', 'HOUSES'] } });
  const actorId = coachUser.id;

  // 6. the Book of Records — the old register typed in, with history
  const senior = (g: 'M' | 'F') => kids.filter((k) => k.std >= 9 && (k.gender ?? '').toUpperCase().startsWith(g));
  const junior = (g: 'M' | 'F') => kids.filter((k) => k.std >= 6 && k.std <= 8 && (k.gender ?? '').toUpperCase().startsWith(g));
  const name = (k: Kid) => `${k.firstName} ${k.lastName}`.trim();
  const book: { sportKey: string; groupKey: string; category: 'Boys' | 'Girls'; history: [string, number, number, number][]; standing: [Kid | string, number, number] }[] = [
    { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', history: [['A. Menon', 12.4, 1998, 2007], ['Kabir Bhat', 12.1, 2007, 2023]], standing: [senior('M')[0] ?? 'Rohan Iyer', 11.9, 2023] },
    { sportKey: 'ath-100m', groupKey: 'sen', category: 'Girls', history: [['S. Rao', 14.6, 2003, 2019]], standing: [senior('F')[0] ?? 'Diya Nair', 13.62, 2019] },
    { sportKey: 'ath-200m', groupKey: 'sen', category: 'Boys', history: [], standing: ['Kabir Bhat', 24.61, 2007] },
    { sportKey: 'ath-400m', groupKey: 'sen', category: 'Girls', history: [['P. Kulkarni', 68.4, 2011, 2022]], standing: [senior('F')[1] ?? 'Meera Iyer', 64.9, 2022] },
    { sportKey: 'ath-800m', groupKey: 'sen', category: 'Girls', history: [['Pia Kapoor', 155.1, 2016, 2024]], standing: [senior('F')[2] ?? 'Diya Nair', 151.4, 2024] },
    { sportKey: 'ath-long-jump', groupKey: 'sen', category: 'Girls', history: [['Isha Bose', 4.51, 2019, 2025]], standing: [senior('F')[3] ?? 'Meera Iyer', 4.62, 2025] },
    { sportKey: 'ath-long-jump', groupKey: 'sen', category: 'Boys', history: [['R. Desai', 5.31, 2009, 2021]], standing: [senior('M')[1] ?? 'Aarav Mehta', 5.58, 2021] },
    { sportKey: 'ath-high-jump', groupKey: 'jun', category: 'Boys', history: [], standing: [junior('M')[0] ?? 'Hiten Shah', 1.42, 2024] },
    { sportKey: 'ath-shot-put', groupKey: 'sen', category: 'Boys', history: [['V. Nair', 10.2, 2001, 2015]], standing: ['F. Ali', 11.3, 2015] },
    { sportKey: 'ath-discus', groupKey: 'sen', category: 'Boys', history: [], standing: ['T. Singh', 29.8, 2018] },
    { sportKey: 'ath-javelin', groupKey: 'sen', category: 'Girls', history: [], standing: [senior('F')[4] ?? 'Esha Iyer', 28.4, 2025] },
    { sportKey: 'swim-50-free', groupKey: 'jun', category: 'Girls', history: [['N. Joshi', 36.2, 2014, 2026]], standing: [junior('F')[0] ?? 'Gauri Sen', 32.8, 2026] },
  ];
  for (const line of book) {
    const sport = sportByKey(line.sportKey)!;
    const unit = sport.scoring.type === 'MARK' ? sport.scoring.unit : 's';
    for (const [holderName, value, since, until] of line.history) {
      await db.sportsRecord.create({ data: { schoolId, sportKey: line.sportKey, groupKey: line.groupKey, category: line.category, value, unit, holderName, sinceYear: since, untilYear: until, status: 'BROKEN', source: 'IMPORT' } });
    }
    const [holder, value, since] = line.standing;
    await db.sportsRecord.create({
      data: {
        schoolId, sportKey: line.sportKey, groupKey: line.groupKey, category: line.category, value, unit,
        holderName: typeof holder === 'string' ? holder : name(holder), holderStudentId: typeof holder === 'string' ? null : holder.id,
        setOn: new Date(Date.UTC(since, 10, 2)), sinceYear: since, status: 'STANDING', source: since >= 2023 ? 'MEET' : 'IMPORT', verifiedById: actorId,
      },
    });
  }
  console.log(`book: ${book.length} lines with history`);

  // 7. meets
  type EventSpec = { sportKey: string; groupKey: string; category: 'Boys' | 'Girls'; structure: 'CLASS' | 'DRAW'; venues: number[]; pool: Kid[]; take: number; lanes?: number };
  const pool = (g: 'M' | 'F', lo: number, hi: number) => kids.filter((k) => k.std >= lo && k.std <= hi && (k.gender ?? '').toUpperCase().startsWith(g));
  const meets: { name: string; startsOn: Date; days: number; status: 'DONE' | 'LIVE'; venues: string[]; events: EventSpec[] }[] = [
    {
      name: 'Annual Sports Meet 2025', startsOn: new Date(Date.UTC(2025, 10, 20)), days: 2, status: 'DONE', venues: ['Track', 'Field', 'Court 1', 'Court 2', 'Pool'],
      events: [
        { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', structure: 'CLASS', venues: [0], pool: pool('M', 9, 12), take: 14, lanes: 6 },
        { sportKey: 'ath-100m', groupKey: 'sen', category: 'Girls', structure: 'CLASS', venues: [0], pool: pool('F', 9, 12), take: 12, lanes: 6 },
        { sportKey: 'ath-200m', groupKey: 'sen', category: 'Boys', structure: 'CLASS', venues: [0], pool: pool('M', 9, 12), take: 10, lanes: 6 },
        { sportKey: 'ath-long-jump', groupKey: 'sen', category: 'Girls', structure: 'CLASS', venues: [1], pool: pool('F', 9, 12), take: 10, lanes: 12 },
        { sportKey: 'ath-shot-put', groupKey: 'sen', category: 'Boys', structure: 'CLASS', venues: [1], pool: pool('M', 9, 12), take: 9, lanes: 12 },
        { sportKey: 'ath-high-jump', groupKey: 'jun', category: 'Boys', structure: 'CLASS', venues: [1], pool: pool('M', 6, 8), take: 10, lanes: 12 },
        { sportKey: 'swim-50-free', groupKey: 'jun', category: 'Girls', structure: 'CLASS', venues: [4], pool: pool('F', 6, 8), take: 11, lanes: 6 },
        { sportKey: 'badminton', groupKey: 'sen', category: 'Boys', structure: 'CLASS', venues: [2, 3], pool: pool('M', 9, 12), take: 12 },
        { sportKey: 'table-tennis', groupKey: 'jun', category: 'Girls', structure: 'DRAW', venues: [3], pool: pool('F', 6, 8), take: 8 },
        { sportKey: 'kabaddi', groupKey: 'sen', category: 'Boys', structure: 'DRAW', venues: [1], pool: pool('M', 9, 12), take: 40 },
        { sportKey: 'football', groupKey: 'jun', category: 'Boys', structure: 'DRAW', venues: [1], pool: pool('M', 6, 8), take: 40 },
      ],
    },
    {
      name: 'Inter-house Athletics 2026', startsOn: todayIst(), days: 2, status: 'LIVE', venues: ['Track', 'Field', 'Court 1'],
      events: [
        { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', structure: 'CLASS', venues: [0], pool: pool('M', 9, 12), take: 11, lanes: 6 },
        { sportKey: 'ath-400m', groupKey: 'sen', category: 'Girls', structure: 'CLASS', venues: [0], pool: pool('F', 9, 12), take: 6, lanes: 6 },
        { sportKey: 'ath-long-jump', groupKey: 'jun', category: 'Girls', structure: 'CLASS', venues: [1], pool: pool('F', 6, 8), take: 8, lanes: 12 },
        { sportKey: 'ath-javelin', groupKey: 'sen', category: 'Girls', structure: 'CLASS', venues: [1], pool: pool('F', 9, 12), take: 7, lanes: 12 },
        { sportKey: 'badminton', groupKey: 'sen', category: 'Girls', structure: 'CLASS', venues: [2], pool: pool('F', 9, 12), take: 10 },
        { sportKey: 'table-tennis', groupKey: 'jun', category: 'Boys', structure: 'DRAW', venues: [2], pool: pool('M', 6, 8), take: 8 },
        { sportKey: 'football', groupKey: 'sen', category: 'Boys', structure: 'DRAW', venues: [1], pool: pool('M', 9, 12), take: 40 },
      ],
    },
  ];

  let pendingAttempt: string | null = null;
  for (const [mi, meet] of meets.entries()) {
    const t = await db.sportsTournament.create({
      data: { schoolId, name: meet.name, startsOn: meet.startsOn, endsOn: new Date(meet.startsOn.getTime() + (meet.days - 1) * DAY), grouping: 'BANDS', dayStartMin: 540, dayEndMin: 990, status: meet.status, published: true, version: 3, createdById: actorId },
      select: { id: true },
    });
    const venueRows = await Promise.all(meet.venues.map((v, order) => db.sportsVenue.create({ data: { schoolId, tournamentId: t.id, name: v, order }, select: { id: true } })));
    const w = { dayStartMin: 540, dayEndMin: 990, days: meet.days };
    const cursor = new Map(venueRows.map((v) => [v.id, 540]));
    const awards: { houseId: string; points: number; reason: string; eventId: string }[] = [];
    const bells: Prisma.NotificationCreateManyInput[] = [];
    for (const [ei, spec] of meet.events.entries()) {
      const sport = sportByKey(spec.sportKey)!;
      const chosen = shuffle(spec.pool, seedOf(`${meet.name}:${spec.sportKey}:${spec.category}`)).slice(0, spec.take);
      const entries: EntryIn[] = chosen.map((k) => ({ studentId: k.id, std: k.std, section: k.section }));
      let plan;
      try { plan = buildEventPlan(sport, spec.structure, entries, seedOf(`${t.id}:${ei}`)); } catch { console.log(`  skip ${sport.name} ${spec.category}: not enough entrants`); continue; }
      const venueIds = spec.venues.map((i) => venueRows[i].id);
      const slotMin = sport.slotMin;
      const lanes = spec.lanes ?? sport.lanes ?? 6;
      if (plan.matches.length) scheduleMatches(plan.matches, venueIds, slotMin, cursor, w);
      if (plan.heats.length) scheduleHeats(plan.heats, venueIds, slotMin, cursor, w);
      const structure = sport.kind === 'MEASURED' ? 'HEATS' : sport.kind === 'JUDGED' ? 'PANEL' : plan.walkovers.length || plan.matches.some((m) => m.stage === 'CLASS') ? 'CLASS' : 'DRAW';
      const ev = await db.sportsEvent.create({ data: { schoolId, tournamentId: t.id, sportKey: sport.key, sportName: sport.name, kind: sport.kind, groupKey: spec.groupKey, category: spec.category, entry: 'ALL', structure, slotMin, lanes, venueIds, order: ei }, select: { id: true } });
      await db.sportsEntry.createMany({ data: entries.map((e) => ({ schoolId, eventId: ev.id, studentId: e.studentId, std: e.std, section: e.section })) });
      const groupLabel = spec.groupKey === 'sen' ? 'Senior' : spec.groupKey === 'jun' ? 'Junior' : 'Sub-junior';
      const line = `${sport.name} ${groupLabel}`;
      const done = meet.status === 'DONE';
      // how much of this event has been played in the live meet: heats by index, matches by round
      const playHeat = (h: HeatPlan) => done || (h.kind === 'HEAT' ? h.idx === 0 : false);
      const playRound = (m: MatchPlan) => done || m.roundIdx === 0;

      if (plan.heats.length) {
        const heatsOut: { id: string; plan: HeatPlan; marks: { studentId: string; lane: number; mark: number | null; rank: number | null }[] }[] = [];
        for (const h of plan.heats) {
          const isDone = playHeat(h);
          const marks = h.lanes.map((l) => {
            const k = chosen.find((c) => `s:${c.id}` === l.side)!;
            const mark = isDone ? (rnd() < 0.06 ? null : markFor(sport, spec.category, 0.25 + rnd() * 0.6)) : null;
            return { studentId: k.id, lane: l.lane, mark, rank: null as number | null };
          });
          if (isDone) {
            const ranked = rankMarks(marks.map((m) => ({ item: m.studentId, mark: m.mark })), sport.scoring.type === 'MARK' && sport.scoring.lowerIsBetter);
            for (const r of ranked) { const m = marks.find((x) => x.studentId === r.item)!; m.rank = r.rank; }
          }
          const row = await db.sportsHeat.create({ data: { schoolId, eventId: ev.id, kind: h.kind, idx: h.idx, venueId: h.venueId, atMin: h.atMin, done: isDone, marks: { createMany: { data: marks.map((m) => ({ schoolId, studentId: m.studentId, lane: m.lane, mark: m.mark, rank: m.rank })) } } }, select: { id: true } });
          heatsOut.push({ id: row.id, plan: h, marks });
        }
        // a finished meet with several heats also ran its final: the best `lanes` marks, one more heat, ranked
        if (done && plan.heats.length > 1) {
          const all = heatsOut.flatMap((h) => h.marks.filter((m) => m.mark != null));
          const lower = sport.scoring.type === 'MARK' && sport.scoring.lowerIsBetter;
          const field = rankMarks(all.map((m) => ({ item: m.studentId, mark: m.mark })), lower).filter((r) => r.rank != null).slice(0, lanes);
          const finalMarks = field.map((r, i) => ({ studentId: r.item, lane: i + 1, mark: markFor(sport, spec.category, 0.45 + rnd() * 0.5), rank: null as number | null }));
          const ranked = rankMarks(finalMarks.map((m) => ({ item: m.studentId, mark: m.mark })), lower);
          for (const r of ranked) finalMarks.find((m) => m.studentId === r.item)!.rank = r.rank;
          const at = Math.max(...heatsOut.map((h) => h.plan.atMin ?? 540)) + slotMin * 6;
          await db.sportsHeat.create({ data: { schoolId, eventId: ev.id, kind: 'FINAL', idx: plan.heats.length, venueId: venueIds[0], atMin: at, done: true, marks: { createMany: { data: finalMarks.map((m) => ({ schoolId, studentId: m.studentId, lane: m.lane, mark: m.mark, rank: m.rank })) } } } });
          for (const m of finalMarks) { const h = houseOf(`s:${m.studentId}`); const p = placingPoints(m.rank, [10, 7, 5, 3, 2, 1]); if (h && p) awards.push({ houseId: h, points: p, reason: `${sport.name} ${spec.category}: ${ordinal(m.rank!)}`, eventId: ev.id }); }
          for (const m of finalMarks) { const k = chosen.find((c) => c.id === m.studentId); if (k?.userId) bells.push({ schoolId, userId: k.userId, kind: 'SPORTS', title: `${sport.name} ${spec.category}: Final`, body: `${fmt(sport, m.mark)} · ${ordinal(m.rank!)}${m.rank === 1 ? ' — champion!' : ''}`, linkType: 'sports', linkId: t.id }); }
        } else if (done && plan.heats.length === 1) {
          for (const m of heatsOut[0].marks) { const h = houseOf(`s:${m.studentId}`); const p = placingPoints(m.rank, [10, 7, 5, 3, 2, 1]); if (h && p) awards.push({ houseId: h, points: p, reason: `${sport.name} ${spec.category}: ${ordinal(m.rank!)}`, eventId: ev.id }); }
        }
        // the live meet: one heat is ranked, and one of its marks beats the book → a pending attempt for the verify queue
        if (!done && heatsOut[0]?.marks.some((m) => m.mark != null) && sport.key === 'ath-100m' && !pendingAttempt) {
          const best = heatsOut[0].marks.filter((m) => m.mark != null).sort((a, b) => a.mark! - b.mark!)[0];
          const value = 11.84;
          await db.sportsMark.update({ where: { heatId_studentId: { heatId: heatsOut[0].id, studentId: best.studentId } }, data: { mark: value, rank: 1 } });
          const a = await db.sportsRecordAttempt.create({ data: { schoolId, sportKey: sport.key, sportName: sport.name, groupKey: spec.groupKey, category: spec.category, studentId: best.studentId, value, unit: 's', source: 'MEET', witnessed: true, status: 'PENDING', enteredById: actorId }, select: { id: true } });
          pendingAttempt = a.id;
        }
      }

      if (plan.matches.length) {
        const created: { id: string; m: Played; winner: string | null }[] = [];
        for (const m of plan.matches) created.push({ id: '', m: { ...m }, winner: m.winner });
        // decide rounds in order so winners flow forward
        const groups = [...new Set(created.map((c) => `${c.m.stage}|${c.m.groupLabel}`))];
        for (const g of groups) {
          const inGroup = created.filter((c) => `${c.m.stage}|${c.m.groupLabel}` === g);
          const rounds = Math.max(...inGroup.map((c) => c.m.roundIdx)) + 1;
          for (let r = 0; r < rounds; r++) {
            for (const c of inGroup.filter((x) => x.m.roundIdx === r)) {
              if (c.m.bye) continue;
              if (!c.m.aSide || !c.m.bSide || !playRound(c.m)) continue;
              const [scoreA, scoreB, winA] = scoreline(sport);
              c.winner = winA ? c.m.aSide : c.m.bSide;
              c.m.scoreA = scoreA; c.m.scoreB = scoreB;
              const next = inGroup.find((x) => x.m.roundIdx === r + 1 && x.m.pos === nextSlot(r, c.m.pos).pos);
              if (next) { if (nextSlot(r, c.m.pos).side === 'a') next.m.aSide = c.winner; else next.m.bSide = c.winner; }
              const h = houseOf(c.winner); if (h) awards.push({ houseId: h, points: 5, reason: `${line} ${c.m.roundName}: win`, eventId: ev.id });
              if (!next && c.m.stage === 'CLASS') { const hc = houseOf(c.winner); if (hc) awards.push({ houseId: hc, points: 3, reason: `${line}: champion`, eventId: ev.id }); }
            }
          }
        }
        // band final for a class-structured, finished event
        if (done && created.some((c) => c.m.stage === 'CLASS')) {
          const champions: string[] = [];
          for (const std of [...new Set(entries.map((e) => e.std))].sort((a, b) => a - b)) {
            const inClass = created.filter((c) => c.m.stage === 'CLASS' && c.m.groupLabel === classLabel(std));
            if (!inClass.length) { const wo = plan.walkovers.find((x) => x.std === std); if (wo) champions.push(wo.side); continue; }
            const last = Math.max(...inClass.map((c) => c.m.roundIdx));
            const f = inClass.find((c) => c.m.roundIdx === last && c.winner);
            if (f?.winner) champions.push(f.winner);
          }
          if (champions.length >= 2) {
            const { rounds } = buildDraw(shuffle(champions, seedOf(`${ev.id}:final`)));
            const finals: { id: string; m: Played; winner: string | null }[] = drawToMatches('FINAL', 'Final', rounds).map((m) => ({ id: '', m: { ...m, atMin: null, venueId: venueIds[0] }, winner: m.winner }));
            scheduleMatches(finals.map((f) => f.m), venueIds, slotMin, cursor, w);
            const total = rounds.length;
            for (let r = 0; r < total; r++) for (const c of finals.filter((x) => x.m.roundIdx === r)) {
              if (c.m.bye || !c.m.aSide || !c.m.bSide) continue;
              const [scoreA, scoreB, winA] = scoreline(sport);
              c.winner = winA ? c.m.aSide : c.m.bSide; c.m.scoreA = scoreA; c.m.scoreB = scoreB;
              const next = finals.find((x) => x.m.roundIdx === r + 1 && x.m.pos === nextSlot(r, c.m.pos).pos);
              if (next) { if (nextSlot(r, c.m.pos).side === 'a') next.m.aSide = c.winner; else next.m.bSide = c.winner; }
              const h = houseOf(c.winner); if (h) awards.push({ houseId: h, points: 5, reason: `${sport.name} Final ${c.m.roundName}: win`, eventId: ev.id });
            }
            for (const p of drawPlacings(rounds.map((round) => round.map((m) => { const c = finals.find((x) => x.m.roundIdx === m.round && x.m.pos === m.pos)!; return { round: m.round, pos: m.pos, a: c.m.aSide, b: c.m.bSide, bye: c.m.bye, winner: c.winner }; })))) {
              const h = houseOf(p.side); const pts = placingPoints(p.rank, [10, 7, 5, 3, 2, 1]); if (h && pts) awards.push({ houseId: h, points: pts, reason: `${sport.name} ${spec.category}: ${ordinal(p.rank)}`, eventId: ev.id });
            }
            created.push(...finals);
          }
        }
        await db.sportsMatch.createMany({
          data: created.map((c) => ({
            schoolId, eventId: ev.id, stage: c.m.stage, groupLabel: c.m.groupLabel, roundIdx: c.m.roundIdx, roundName: c.m.roundName, pos: c.m.pos, aSide: c.m.aSide, bSide: c.m.bSide,
            scoreA: c.m.scoreA ?? [], scoreB: c.m.scoreB ?? [], winner: c.winner, bye: c.m.bye, walkover: false, venueId: c.m.venueId, atMin: c.m.atMin, version: c.winner && !c.m.bye ? 2 : 1,
            savedById: c.winner && !c.m.bye ? actorId : null, savedAt: c.winner && !c.m.bye ? new Date(meet.startsOn.getTime() + (c.m.atMin ?? 600) * 60_000) : null,
          })),
        });
      }
      console.log(`  ${meet.name} · ${sport.name} ${groupLabel} ${spec.category}: ${entries.length} entered, ${plan.matches.length} matches, ${plan.heats.length} heats`);
    }
    if (awards.length) await db.housePoint.createMany({ data: awards.map((a) => ({ schoolId, ...a })) });
    if (bells.length) await db.notification.createMany({ data: bells.slice(0, 200) });
    console.log(`${meet.name}: ${awards.length} house point rows${mi === 1 && pendingAttempt ? ', one record attempt waiting for a signature' : ''}`);
  }
  // a sports-day spirit award so the ledger shows a manual row too
  await db.housePoint.create({ data: { schoolId, houseId: houseRows[1].id, points: 15, reason: 'March-past: best turnout' } });

  // 8. the website: on, with consent, pinned homepage lines
  const profile = await db.schoolProfile.findUnique({ where: { schoolId }, select: { sectionVariants: true } });
  const variants = (profile?.sectionVariants && typeof profile.sectionVariants === 'object' ? { ...(profile.sectionVariants as Record<string, unknown>) } : {}) as Record<string, unknown>;
  variants.records = { layout: 'TILES' };
  const order = Array.isArray(variants.__order) ? (variants.__order as string[]).filter((k) => k !== 'records') : null;
  if (order) { const i = order.indexOf('hof'); order.splice(i >= 0 ? i + 1 : order.length, 0, 'records'); variants.__order = order; }
  const recordsConfig = { enabled: true, consentConfirmed: true, nameFormat: 'FIRST_INITIAL', pageLayout: 'CABINET', homeScope: 'PINNED', homeCount: 4, pinned: ['ath-100m|sen|Boys', 'ath-long-jump|sen|Girls', 'ath-800m|sen|Girls', 'swim-50-free|jun|Girls'], showTopFive: true, groups: [] };
  await db.schoolProfile.upsert({ where: { schoolId }, update: { recordsConfig, sectionVariants: variants as Prisma.InputJsonValue }, create: { schoolId, recordsConfig, sectionVariants: variants as Prisma.InputJsonValue } });
  console.log('website: Book of Records on (Podium tiles band, Medal cabinet page, four pinned lines)');
  console.log(`logins: admin as before; sports teacher ${coachEmail} / password`);
}

function ordinal(n: number): string { const r = n % 100; return `${n}${r >= 11 && r <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`; }
function fmt(sport: Sport, v: number | null): string { const s = sport.scoring; if (v == null || s.type !== 'MARK') return '—'; if (s.unit === 's' && v >= 60) { const m = Math.floor(v / 60); return `${m}:${(v - m * 60).toFixed(2).padStart(5, '0')}`; } return `${v.toFixed(s.precision)} ${s.unit}`; }
/** A believable finished scoresheet for the sport: [scoreA, scoreB, aWins]. */
function scoreline(sport: Sport): [number[], number[], boolean] {
  const s = sport.scoring;
  const aWins = rnd() < 0.5;
  if (s.type === 'GAMES') {
    const need = Math.ceil(s.bestOf / 2);
    const a: number[] = []; const b: number[] = [];
    let wa = 0, wb = 0;
    while (wa < need && wb < need) {
      const winner = wa === need - 1 && wb === need - 1 ? aWins : rnd() < (aWins ? 0.68 : 0.32);
      const loserPts = Math.floor(rnd() * (s.to - 3));
      const [x, y] = winner ? [s.to, loserPts] : [loserPts, s.to];
      a.push(x); b.push(y); if (winner) wa++; else wb++;
    }
    if ((wa === need) !== aWins) { const ra = [...a]; a.splice(0, a.length, ...b); b.splice(0, b.length, ...ra); }
    return [a, b, aWins];
  }
  const hi = sport.key === 'kabaddi' ? 45 : sport.key === 'basketball' ? 60 : 4;
  const lo = sport.key === 'kabaddi' ? 18 : 0;
  let x = lo + Math.floor(rnd() * (hi - lo)); let y = lo + Math.floor(rnd() * (hi - lo));
  if (x === y) { if (rnd() < 0.5) x += 1; else return aWins ? [[x, 4], [y, 3], true] : [[x, 3], [y, 4], false]; }
  const winA = x > y;
  return winA === aWins ? [[x], [y], winA] : [[y], [x], !winA];
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
