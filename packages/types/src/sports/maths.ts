/**
 * Sports maths — every rule the desk relies on, as pure functions with no
 * clock, no random and no database, so both the API and the web run the same
 * arithmetic and the spec can pin every branch.
 */
import type { GamesScoring, MarkScoring, Scoring, SingleScoring } from './catalogue';

// ── side keys ─────────────────────────────────────────────────
/** A side of a match: an individual student or a section team. Stored as text, never a FK, so history outlives a roster change. */
export type SideKey = string;
export const sideOfStudent = (studentId: string): SideKey => `s:${studentId}`;
export const sideOfSection = (std: number, section: string): SideKey => `c:${std}-${section.trim().toUpperCase()}`;
export function parseSide(key: SideKey): { kind: 'student'; studentId: string } | { kind: 'section'; std: number; section: string } | null {
  if (key.startsWith('s:')) return { kind: 'student', studentId: key.slice(2) };
  const m = /^c:(\d+)-(.+)$/.exec(key);
  if (m) return { kind: 'section', std: Number(m[1]), section: m[2] };
  return null;
}

// ── scores → winner ───────────────────────────────────────────
export interface Judgement { winner: 'A' | 'B' | null; complete: boolean; error?: 'BAD_SCORE' | 'EXTRA_GAME' | 'TIE_DECIDER' | 'NOT_A_MATCH' }

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function gameDone(s: GamesScoring, a: number, b: number, isLast: boolean): boolean {
  const to = isLast && s.finalTo ? s.finalTo : s.to;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === lo) return false;
  if (s.cap && hi === s.cap) return true;
  if (s.cap && hi > s.cap) return false;
  return hi >= to && hi - lo >= s.winBy;
}

/** Judge a scoresheet. Incomplete is not an error: the desk saves partial games while play goes on. */
export function judgeScores(scoring: Scoring, scoreA: number[], scoreB: number[]): Judgement {
  if (scoring.type === 'MARK') return { winner: null, complete: false, error: 'NOT_A_MATCH' };
  if (scoreA.length !== scoreB.length || ![...scoreA, ...scoreB].every(isCount)) return { winner: null, complete: false, error: 'BAD_SCORE' };
  if (scoring.type === 'SINGLE') return judgeSingle(scoreA, scoreB);
  return judgeGames(scoring, scoreA, scoreB);
}

function judgeSingle(scoreA: number[], scoreB: number[]): Judgement {
  if (scoreA.length === 0) return { winner: null, complete: false };
  if (scoreA.length > 2) return { winner: null, complete: false, error: 'BAD_SCORE' };
  if (scoreA[0] !== scoreB[0]) {
    if (scoreA.length === 2) return { winner: null, complete: false, error: 'BAD_SCORE' }; // a decider without a tie
    return { winner: scoreA[0] > scoreB[0] ? 'A' : 'B', complete: true };
  }
  if (scoreA.length === 1) return { winner: null, complete: false, error: 'TIE_DECIDER' };
  if (scoreA[1] === scoreB[1]) return { winner: null, complete: false, error: 'TIE_DECIDER' };
  return { winner: scoreA[1] > scoreB[1] ? 'A' : 'B', complete: true };
}

function judgeGames(s: GamesScoring, scoreA: number[], scoreB: number[]): Judgement {
  const need = Math.ceil(s.bestOf / 2);
  let a = 0;
  let b = 0;
  for (let i = 0; i < scoreA.length; i++) {
    if (a === need || b === need) return { winner: null, complete: false, error: 'EXTRA_GAME' };
    const last = i === s.bestOf - 1;
    if (!gameDone(s, scoreA[i], scoreB[i], last)) {
      // only the final listed game may be in progress
      if (i !== scoreA.length - 1) return { winner: null, complete: false, error: 'BAD_SCORE' };
      if (s.cap && Math.max(scoreA[i], scoreB[i]) > s.cap) return { winner: null, complete: false, error: 'BAD_SCORE' };
      return { winner: null, complete: false };
    }
    if (scoreA[i] > scoreB[i]) a++; else b++;
  }
  if (a === need) return { winner: 'A', complete: true };
  if (b === need) return { winner: 'B', complete: true };
  return { winner: null, complete: false };
}

// ── marks ─────────────────────────────────────────────────────
export function formatMark(s: MarkScoring, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (s.unit === 's') {
    if (value >= 60) {
      const min = Math.floor(value / 60);
      const sec = value - min * 60;
      return `${min}:${sec.toFixed(2).padStart(5, '0')}`;
    }
    return `${value.toFixed(s.precision)} s`;
  }
  const n = value.toFixed(s.precision);
  return s.unit === 'reps' ? n : `${n} ${s.unit}`;
}

/** "12.34", "1:05.20", "5.42" → number; null for anything that is not a mark. */
export function parseMark(s: MarkScoring, text: string): number | null {
  const t = text.trim().replace(/\s*(s|m|kg|pts|reps)$/i, '');
  if (!t) return null;
  let value: number;
  if (s.unit === 's' && t.includes(':')) {
    const [m, sec] = t.split(':');
    if (!/^\d+$/.test(m) || !/^\d+(\.\d+)?$/.test(sec)) return null;
    value = Number(m) * 60 + Number(sec);
  } else {
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    value = Number(t);
  }
  return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(s.precision)) : null;
}

export interface Ranked<T> { item: T; mark: number | null; rank: number | null }
/** Rank by mark; ties share a rank and the next rank skips (1, 1, 3). No mark (DNF, NM) ranks last with no rank. */
export function rankMarks<T>(items: { item: T; mark: number | null }[], lowerIsBetter: boolean): Ranked<T>[] {
  const marked = items.filter((i) => i.mark != null && Number.isFinite(i.mark)).sort((x, y) => (lowerIsBetter ? x.mark! - y.mark! : y.mark! - x.mark!));
  const out: Ranked<T>[] = [];
  marked.forEach((m, idx) => {
    const rank = idx > 0 && out[idx - 1].mark === m.mark ? out[idx - 1].rank : idx + 1;
    out.push({ item: m.item, mark: m.mark, rank });
  });
  for (const i of items) if (i.mark == null || !Number.isFinite(i.mark)) out.push({ item: i.item, mark: null, rank: null });
  return out;
}

export function beatsRecord(s: MarkScoring, value: number, record: number): boolean {
  const f = 10 ** s.precision;
  const v = Math.round(value * f);
  const r = Math.round(record * f);
  return s.lowerIsBetter ? v < r : v > r;
}

// ── knockout draws ────────────────────────────────────────────
export interface DrawMatch { round: number; pos: number; a: SideKey | null; b: SideKey | null; bye: boolean; winner: SideKey | null }

export function bracketSize(n: number): number { let s = 2; while (s < n) s *= 2; return s; }

/** Standard seeding order: seed 1 and 2 land in opposite halves, byes fall to the top seeds. 1-based seeds per slot. */
export function seedPositions(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function roundName(round: number, totalRounds: number): string {
  const players = 2 ** (totalRounds - round);
  if (players === 2) return 'Final';
  if (players === 4) return 'Semi-final';
  if (players === 8) return 'Quarter-final';
  return `Round of ${players}`;
}

/** Sides in seeding order (shuffle first for a blind draw). Byes are resolved: the present side wins and is placed in round 2. */
export function buildDraw(sides: SideKey[]): { size: number; rounds: DrawMatch[][] } {
  const uniq = [...new Set(sides)];
  if (uniq.length < 2) throw new Error('NEED_TWO_SIDES');
  const size = bracketSize(uniq.length);
  const slots = seedPositions(size).map((seed) => (seed <= uniq.length ? uniq[seed - 1] : null));
  const totalRounds = Math.log2(size);
  const rounds: DrawMatch[][] = [];
  for (let r = 0; r < totalRounds; r++) {
    const count = size / 2 ** (r + 1);
    rounds.push(Array.from({ length: count }, (_, pos) => ({ round: r, pos, a: null, b: null, bye: false, winner: null })));
  }
  rounds[0].forEach((m, pos) => {
    m.a = slots[pos * 2];
    m.b = slots[pos * 2 + 1];
    if (m.a && m.b) return;
    m.bye = true;
    m.winner = m.a ?? m.b;
    if (rounds.length > 1) {
      const next = nextSlot(0, pos);
      rounds[1][next.pos][next.side] = m.winner;
    }
  });
  return { size, rounds };
}

export function nextSlot(round: number, pos: number): { round: number; pos: number; side: 'a' | 'b' } {
  return { round: round + 1, pos: Math.floor(pos / 2), side: pos % 2 === 0 ? 'a' : 'b' };
}

/** Deterministic shuffle (mulberry32) so a draw can be replayed from its seed. */
export function shuffle<T>(items: T[], seed: number): T[] {
  let t = seed >>> 0;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Placings from a finished (or partly finished) draw: champion 1, runner-up 2, semi losers joint 3, quarter losers joint 5 … */
export function drawPlacings(rounds: { round: number; a: SideKey | null; b: SideKey | null; winner: SideKey | null; bye: boolean }[][]): { side: SideKey; rank: number }[] {
  const out: { side: SideKey; rank: number }[] = [];
  const total = rounds.length;
  const final = rounds[total - 1]?.[0];
  if (final?.winner) {
    out.push({ side: final.winner, rank: 1 });
    const loser = final.a === final.winner ? final.b : final.a;
    if (loser) out.push({ side: loser, rank: 2 });
  }
  for (let r = total - 2; r >= 0; r--) {
    const rank = 2 ** (total - r - 1) + 1; // semis → 3, quarters → 5, R16 → 9
    for (const m of rounds[r]) {
      if (!m.winner || m.bye) continue;
      const loser = m.a === m.winner ? m.b : m.a;
      if (loser) out.push({ side: loser, rank });
    }
  }
  return out;
}

// ── class round → band final ──────────────────────────────────
export interface EntrySide { side: SideKey; std: number }
/** CLASS structure: one draw per class with two or more sides; a lone side is that class's champion by walkover. Fewer than two classes → a single draw. */
export function planClassStage(entries: EntrySide[]): { mode: 'CLASS' | 'DRAW'; classes: { std: number; sides: SideKey[]; walkover: SideKey | null }[] } {
  const byStd = new Map<number, Set<SideKey>>();
  for (const e of entries) byStd.set(e.std, (byStd.get(e.std) ?? new Set()).add(e.side));
  const classes = [...byStd.entries()].sort((x, y) => x[0] - y[0]).map(([std, set]) => {
    const sides = [...set];
    return { std, sides, walkover: sides.length === 1 ? sides[0] : null };
  });
  return { mode: classes.length >= 2 ? 'CLASS' : 'DRAW', classes };
}

// ── heats ─────────────────────────────────────────────────────
export interface Heat { idx: number; kind: 'HEAT' | 'FINAL'; lanes: { lane: number; side: SideKey }[] }
/** Balanced heats of at most `lanes`; one heat is the final straight away. */
export function planHeats(sides: SideKey[], lanes: number): Heat[] {
  const uniq = [...new Set(sides)];
  if (uniq.length === 0) return [];
  const width = Math.max(1, lanes);
  if (uniq.length <= width) return [{ idx: 0, kind: 'FINAL', lanes: uniq.map((side, i) => ({ lane: i + 1, side })) }];
  const count = Math.ceil(uniq.length / width);
  const base = Math.floor(uniq.length / width === count ? width : uniq.length / count);
  const extra = uniq.length - base * count;
  const heats: Heat[] = [];
  let cursor = 0;
  for (let h = 0; h < count; h++) {
    const n = base + (h < extra ? 1 : 0);
    heats.push({ idx: h, kind: 'HEAT', lanes: uniq.slice(cursor, cursor + n).map((side, i) => ({ lane: i + 1, side })) });
    cursor += n;
  }
  return heats;
}

/** The final's field: the best `lanes` marks across heats; a tie at the cut brings everyone on that mark. */
export function finalists(marks: { side: SideKey; mark: number | null }[], lanes: number, lowerIsBetter: boolean): SideKey[] {
  const ranked = rankMarks(marks.map((m) => ({ item: m.side, mark: m.mark })), lowerIsBetter).filter((r) => r.mark != null);
  const out: SideKey[] = [];
  for (const r of ranked) {
    if (out.length < lanes || (out.length > 0 && r.mark === ranked[out.length - 1].mark)) out.push(r.item);
    else break;
  }
  return out;
}

// ── time on the day board ─────────────────────────────────────
export const MIN_PER_DAY = 1440;
export const dayOf = (atMin: number) => Math.floor(atMin / MIN_PER_DAY);
export const minuteOfDay = (atMin: number) => atMin - dayOf(atMin) * MIN_PER_DAY;
export function hhmm(atMin: number): string {
  const m = minuteOfDay(atMin);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface Slot { venueId: string; atMin: number }
export interface DayWindow { dayStartMin: number; dayEndMin: number; days: number }

/** The next start on a venue that fits a slot inside the day window, rolling to the next day when the day is full. */
export function fitInDay(atMin: number, slotMin: number, w: DayWindow): number {
  let t = atMin;
  const day = dayOf(t);
  if (minuteOfDay(t) < w.dayStartMin) t = day * MIN_PER_DAY + w.dayStartMin;
  if (minuteOfDay(t) + slotMin > w.dayEndMin) t = (dayOf(t) + 1) * MIN_PER_DAY + w.dayStartMin;
  return t;
}

/**
 * Place `rounds[k]` matches round by round on the venues: each match takes the
 * earliest free venue; a round starts only after the previous round has
 * finished so nobody plays twice at once. `cursor` (venueId → next free
 * minute) is shared across events on the same venues and is advanced in place.
 */
export function planRounds(rounds: number[], venueIds: string[], slotMin: number, cursor: Map<string, number>, w: DayWindow): Slot[][] {
  if (venueIds.length === 0) throw new Error('NEED_VENUE');
  const out: Slot[][] = [];
  let floor = 0;
  for (const count of rounds) {
    const slots: Slot[] = [];
    let roundEnd = floor;
    for (let i = 0; i < count; i++) {
      let best: string | null = null;
      let bestAt = Infinity;
      for (const v of venueIds) {
        const at = fitInDay(Math.max(cursor.get(v) ?? 0, floor), slotMin, w);
        if (at < bestAt) { bestAt = at; best = v; }
      }
      slots.push({ venueId: best!, atMin: bestAt });
      cursor.set(best!, bestAt + slotMin);
      roundEnd = Math.max(roundEnd, bestAt + slotMin);
    }
    out.push(slots);
    floor = roundEnd;
  }
  return out;
}

/** Slide every slot by `deltaMin` (rain delay), keeping it inside the day window. */
export function shiftSlots(slots: Slot[], deltaMin: number, slotMin: number, w: DayWindow): Slot[] {
  return slots.map((s) => ({ ...s, atMin: fitInDay(s.atMin + deltaMin, slotMin, w) }));
}

// ── clashes ───────────────────────────────────────────────────
export interface Booking { id: string; people: string[]; venueId: string | null; atMin: number | null; slotMin: number }
export interface Clash { kind: 'PERSON' | 'VENUE'; who: string; first: string; second: string }

const overlaps = (x: Booking, y: Booking) => x.atMin != null && y.atMin != null && x.atMin < y.atMin + y.slotMin && y.atMin < x.atMin + x.slotMin;

/** A person in two bookings at once, or a venue holding two at once. */
export function findClashes(bookings: Booking[]): Clash[] {
  const out: Clash[] = [];
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      const x = bookings[i];
      const y = bookings[j];
      if (!overlaps(x, y)) continue;
      if (x.venueId && x.venueId === y.venueId) out.push({ kind: 'VENUE', who: x.venueId, first: x.id, second: y.id });
      const ys = new Set(y.people);
      for (const p of x.people) if (ys.has(p)) out.push({ kind: 'PERSON', who: p, first: x.id, second: y.id });
    }
  }
  return out;
}

// ── points ────────────────────────────────────────────────────
export const placingPoints = (rank: number | null, table: number[]) => (rank && rank >= 1 ? table[rank - 1] ?? 0 : 0);

// ── grouping ──────────────────────────────────────────────────
export interface Band { id: string; label: string; stds: number[] }
export const AGE_GROUPS = [
  { id: 'u14', label: 'Under 14', under: 14 },
  { id: 'u17', label: 'Under 17', under: 17 },
  { id: 'u19', label: 'Under 19', under: 19 },
] as const;

export const DEFAULT_BANDS: Band[] = [
  { id: 'sub', label: 'Sub-junior', stds: [1, 2, 3, 4, 5, 6] },
  { id: 'jun', label: 'Junior', stds: [7, 8] },
  { id: 'sen', label: 'Senior', stds: [9, 10, 11, 12] },
];

/** Bands must be 1–6, each with a slug id, a label and at least one class; no class may sit in two bands. Returns the problem, or null. */
export function validateBands(bands: unknown): string | null {
  if (!Array.isArray(bands) || bands.length === 0 || bands.length > 6) return 'Give between one and six bands.';
  const ids = new Set<string>();
  const seen = new Set<number>();
  for (const b of bands as Partial<Band>[]) {
    if (!b || typeof b.id !== 'string' || !/^[a-z0-9-]{1,20}$/.test(b.id) || ids.has(b.id)) return 'Each band needs a unique short id.';
    ids.add(b.id);
    if (typeof b.label !== 'string' || !b.label.trim() || b.label.length > 40) return 'Each band needs a name.';
    if (!Array.isArray(b.stds) || b.stds.length === 0) return `Band "${b.label}" needs at least one class.`;
    for (const s of b.stds) {
      if (!Number.isInteger(s) || (s as number) < 1 || (s as number) > 12) return `Band "${b.label}" has a class outside 1–12.`;
      if (seen.has(s as number)) return `Class ${s} is in two bands.`;
      seen.add(s as number);
    }
  }
  return null;
}

export const bandFor = (bands: Band[], std: number) => bands.find((b) => b.stds.includes(std)) ?? null;

/** School Games rule: "under N" means born on or after 1 January of (meetYear − N + 1); age counts as on 31 December of the meet year. */
export function ageGroupFor(dob: Date, meetYear: number): (typeof AGE_GROUPS)[number] | null {
  const born = Date.UTC(dob.getUTCFullYear(), dob.getUTCMonth(), dob.getUTCDate());
  for (const g of AGE_GROUPS) if (born >= Date.UTC(meetYear - g.under + 1, 0, 1)) return g;
  return null;
}

export function groupLabel(grouping: 'BANDS' | 'AGE', bands: Band[], key: string): string {
  if (grouping === 'AGE') return AGE_GROUPS.find((g) => g.id === key)?.label ?? key;
  return bands.find((b) => b.id === key)?.label ?? key;
}

// ── class numbers ─────────────────────────────────────────────
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
/** "9", "9th", "Class 9", "Grade IX", "STD-10" → the class number; "Nursery"/"LKG"/"UKG" → null; falls back to `order` when it is 1–12. */
export function stdOfGrade(grade: { name: string; order?: number | null }): number | null {
  const name = grade.name.trim().toLowerCase();
  const num = /(?:^|[^0-9])(\d{1,2})(?:[^0-9]|$)/.exec(name);
  if (num) {
    const n = Number(num[1]);
    if (n >= 1 && n <= 12) return n;
  }
  const word = name.replace(/^(class|grade|std\.?|standard)\s*[-:]?\s*/i, '').replace(/(st|nd|rd|th)$/, '').trim();
  if (ROMAN[word]) return ROMAN[word];
  if (grade.order != null && grade.order >= 1 && grade.order <= 12 && !/nursery|kg|kindergarten|pre/.test(name)) return grade.order;
  return null;
}

/** Where each venue is next free, from what is already on the board (used when a final is added to a live meet). */
export function cursorFrom(bookings: { venueId: string | null; atMin: number | null; slotMin: number }[], venueIds: string[], w: DayWindow): Map<string, number> {
  const cursor = new Map<string, number>(venueIds.map((v) => [v, w.dayStartMin]));
  for (const b of bookings) {
    if (!b.venueId || b.atMin == null || !cursor.has(b.venueId)) continue;
    cursor.set(b.venueId, Math.max(cursor.get(b.venueId)!, b.atMin + b.slotMin));
  }
  return cursor;
}

export const isSingleScoring = (s: Scoring): s is SingleScoring => s.type === 'SINGLE';
export const isMarkScoring = (s: Scoring): s is MarkScoring => s.type === 'MARK';
