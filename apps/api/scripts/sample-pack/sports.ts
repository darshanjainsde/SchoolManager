import type { Prisma } from '@skoolos/db';
import { SportsHousesService } from '../../src/modules/sports/internal/sports-houses.service';
import { SportsRecordsService } from '../../src/modules/sports/internal/sports-records.service';
import { SportsResultsService } from '../../src/modules/sports/internal/sports-results.service';
import { SportsSettingsService } from '../../src/modules/sports/internal/sports-settings.service';
import { SportsTournamentsService } from '../../src/modules/sports/internal/sports-tournaments.service';
import { Ctx, StudentInfo, many } from './ctx';
import { FIRST_F, FIRST_M, SURNAMES } from './data';
import { clamp } from './rng';

type Band = 'sub' | 'jun' | 'sen';
type Cat = 'Boys' | 'Girls';
const BANDS: Band[] = ['sub', 'jun', 'sen'];
const CATS: Cat[] = ['Boys', 'Girls'];
/** The default bands: class 1–6, 7–8, 9–12. Nursery–UKG have no class number and never enter a meet. */
const bandOf = (gradeIdx: number): Band | null => (gradeIdx < 3 ? null : gradeIdx - 2 <= 6 ? 'sub' : gradeIdx - 2 <= 8 ? 'jun' : 'sen');

/** The best ever, by line: [sub, jun, sen] for Boys then Girls. Times are seconds, the rest metres. */
const BOOK: Record<string, { boys: [number, number, number]; girls: [number, number, number]; lowerIsBetter: boolean; step: number }> = {
  'ath-100m': { boys: [13.6, 12.6, 11.5], girls: [14.2, 13.2, 12.6], lowerIsBetter: true, step: 0.3 },
  'ath-200m': { boys: [28.4, 26.0, 23.6], girls: [29.9, 27.4, 26.1], lowerIsBetter: true, step: 0.6 },
  'ath-long-jump': { boys: [4.1, 4.9, 6.2], girls: [3.7, 4.3, 5.1], lowerIsBetter: false, step: 0.15 },
  'ath-shot-put': { boys: [6.8, 8.9, 11.8], girls: [5.9, 7.6, 9.4], lowerIsBetter: false, step: 0.25 },
};

/** What an ordinary finalist runs or jumps: the record's neighbourhood, a little behind it. */
const TYPICAL: Record<string, { boys: [number, number, number]; girls: [number, number, number] }> = {
  'ath-100m': { boys: [15.2, 13.9, 12.7], girls: [16.0, 14.7, 14.0] },
  'ath-long-jump': { boys: [3.1, 3.9, 4.9], girls: [2.8, 3.4, 4.0] },
};

const bi = (b: Band) => BANDS.indexOf(b);

/**
 * Sports Day through the REAL sports services: the meet is built by the
 * tournament planner (heats, finals, a knockout, a venue schedule that keeps each
 * child's diary clear), published, played mark by mark and match by match, and
 * finished — so the desk, the student's page, the house points and the website's
 * Book of Records are all read from rows the product itself wrote.
 */
export async function sports(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const settings = new SportsSettingsService();
  const tournaments = new SportsTournamentsService(settings);
  const houses = new SportsHousesService();
  // The records desk is only asked to note an attempt; it never sends a letter here.
  const records = new SportsRecordsService(undefined as never, undefined as never, settings);
  const results = new SportsResultsService(tournaments, houses, settings, records);
  const actor = c.officeUserId;
  await settings.get(schoolId);

  /* ── the Book of Records, as it stood before this year's meet ── */
  const rec: Prisma.SportsRecordCreateManyInput[] = [];
  const holder = (cat: Cat) => `${r.pick(cat === 'Boys' ? FIRST_M : FIRST_F)} ${r.pick(SURNAMES)}`;
  for (const [sportKey, line] of Object.entries(BOOK)) {
    for (const cat of CATS) {
      BANDS.forEach((band, i) => {
        let value = (cat === 'Boys' ? line.boys : line.girls)[i]!;
        // One line is deliberately soft so this year's winner beats it and a record waits to be verified.
        if (sportKey === 'ath-100m' && band === 'jun' && cat === 'Boys') value = 13.4;
        const since = r.int(2016, 2025);
        const unit = line.lowerIsBetter ? 's' : 'm';
        rec.push({ schoolId, sportKey, groupKey: band, category: cat, value, unit, holderName: holder(cat), setOn: new Date(Date.UTC(since, 8, 20)), sinceYear: since, status: 'STANDING', source: 'IMPORT', note: null });
        if (since > 2017 && r.chance(0.7)) {
          const worse = Number((line.lowerIsBetter ? value + line.step : value - line.step).toFixed(2));
          const from = since - r.int(2, 5);
          rec.push({ schoolId, sportKey, groupKey: band, category: cat, value: worse, unit, holderName: holder(cat), setOn: new Date(Date.UTC(from, 8, 20)), sinceYear: from, untilYear: since, status: 'BROKEN', source: 'IMPORT', note: null });
        }
      });
    }
  }
  await many(c, 'SportsRecord', rec, (b) => p.sportsRecord.createMany({ data: b }));

  /* ── who may enter what ── */
  const byBand = new Map<string, StudentInfo[]>();
  const rows = await p.student.findMany({ where: { schoolId, status: 'ACTIVE' }, select: { id: true, gender: true, classSection: { select: { name: true, grade: { select: { order: true } } } } } });
  const info = new Map(c.students.map((s) => [s.id, s]));
  for (const row of rows) {
    const s = info.get(row.id);
    const band = s ? bandOf(s.gradeIdx) : null;
    if (!s || !band || !row.gender) continue;
    const cat: Cat = row.gender === 'F' ? 'Girls' : 'Boys';
    const key = `${band}|${cat}`;
    byBand.set(key, [...(byBand.get(key) ?? []), s]);
  }
  const take = (band: Band, cat: Cat, n: number) => r.shuffle(byBand.get(`${band}|${cat}`) ?? []).slice(0, n).map((s) => s.id);

  const events: {
    sportKey: string; groupKey: Band; category: Cat; structure: 'CLASS' | 'DRAW'; venueIdx: number[]; studentIds: string[];
    teamBasis?: 'SECTIONS'; stageShape?: 'STRAIGHT'; lanes?: number;
  }[] = [];
  for (const band of BANDS) {
    for (const cat of CATS) {
      events.push({ sportKey: 'ath-100m', groupKey: band, category: cat, structure: 'DRAW', venueIdx: [0], studentIds: take(band, cat, 24), stageShape: 'STRAIGHT' });
      events.push({ sportKey: 'ath-long-jump', groupKey: band, category: cat, structure: 'DRAW', venueIdx: [1], studentIds: take(band, cat, 18), stageShape: 'STRAIGHT' });
    }
  }
  // Kho-kho: the whole of classes 7 and 8, sections against sections.
  for (const cat of CATS) {
    const all = (byBand.get(`jun|${cat}`) ?? []).map((s) => s.id);
    if (all.length >= 8) events.push({ sportKey: 'kho-kho', groupKey: 'jun', category: cat, structure: 'DRAW', venueIdx: [2], studentIds: all, teamBasis: 'SECTIONS' });
  }

  const made = await tournaments.create(schoolId, actor, {
    name: 'Annual Sports Day 2026', startsOn: '2026-09-18', endsOn: '2026-09-19', dayStartMin: 540, dayEndMin: 960,
    venues: [{ name: 'Main track' }, { name: 'Jumping pit' }, { name: 'Kho-kho court' }],
    events,
  } as never);
  await tournaments.publish(schoolId, made.id, true);

  /* ── play it ── */
  const evs = await p.sportsEvent.findMany({ where: { schoolId, tournamentId: made.id }, orderBy: { order: 'asc' } });
  const bandIdx = (k: string) => bi(k as Band);
  for (const ev of evs) {
    if (ev.kind === 'MEASURED') {
      const typ = TYPICAL[ev.sportKey]!;
      const book = BOOK[ev.sportKey]!;
      const base = (ev.category === 'Boys' ? typ.boys : typ.girls)[bandIdx(ev.groupKey)]!;
      const record = (ev.category === 'Boys' ? book.boys : book.girls)[bandIdx(ev.groupKey)]!;
      const softLine = ev.sportKey === 'ath-100m' && ev.groupKey === 'jun' && ev.category === 'Boys';
      const markFor = (): number => {
        let v = base + r.normal(0, book.lowerIsBetter ? 0.55 : 0.35);
        // Nothing but the soft line may beat the book: a stray mark would queue a record nobody expects.
        if (!softLine) v = book.lowerIsBetter ? Math.max(v, record + 0.2) : Math.min(v, record - 0.1);
        return Number(clamp(v, 0.1, 10_000).toFixed(2));
      };
      for (let guard = 0; guard < 8; guard += 1) {
        const open = await p.sportsHeat.findMany({ where: { schoolId, eventId: ev.id, done: false }, include: { marks: true }, orderBy: [{ kind: 'desc' }, { idx: 'asc' }] });
        if (!open.length) break;
        // Heats before the final: `kind` sorts HEAT/SEMI after FINAL, so take them first by hand.
        const next = open.filter((h) => h.kind !== 'FINAL');
        for (const heat of next.length ? next : open) {
          await results.marks(schoolId, actor, heat.id, { marks: heat.marks.map((m) => ({ studentId: m.studentId, mark: r.chance(0.03) ? null : markFor() })), done: true });
        }
      }
    } else {
      for (let guard = 0; guard < 12; guard += 1) {
        const ready = await p.sportsMatch.findMany({ where: { schoolId, eventId: ev.id, winner: null, bye: false, aSide: { not: null }, bSide: { not: null } }, orderBy: [{ roundIdx: 'asc' }, { pos: 'asc' }] });
        if (!ready.length) break;
        for (const m of ready) {
          const a = r.int(8, 24);
          const b = a + (r.chance(0.5) ? -1 : 1) * r.int(1, 9);
          await results.score(schoolId, actor, m.id, { scoreA: [a], scoreB: [Math.max(0, b === a ? b + 1 : b)], version: m.version });
        }
      }
    }
  }
  await tournaments.finish(schoolId, made.id);

  /* ── a pack must not be able to reach a real phone ── */
  await p.notificationOutbox.deleteMany({ where: { schoolId } });
  for (const [label, n] of [
    ['SportsTournament', 1], ['SportsEvent', evs.length],
  ] as const) c.counts[label] = n;
}
