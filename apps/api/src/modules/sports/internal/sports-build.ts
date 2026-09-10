/**
 * Turns a wizard's event into rows: draws per class (or one draw), heats per
 * lane count, and a venue schedule that keeps every child's diary clear. Pure —
 * the service only persists what comes out, so the spec can pin every shape
 * without a database.
 */
import {
  buildDraw, planClassStage, planHeats, planRounds, roundName, shuffle, sideOfEntry, sidesAreSections,
  type DayWindow, type Diary, type DrawMatch, type Sport, type TeamBasis,
} from '@skoolos/types';

export interface EntryIn { studentId: string; std: number; section: string; houseId?: string | null }
export interface MatchPlan {
  stage: 'CLASS' | 'FINAL'; groupLabel: string; roundIdx: number; roundName: string; pos: number;
  aSide: string | null; bSide: string | null; bye: boolean; winner: string | null; venueId: string | null; atMin: number | null;
}
export interface HeatPlan { kind: 'HEAT' | 'FINAL'; idx: number; venueId: string | null; atMin: number | null; lanes: { lane: number; side: string }[] }
export interface EventPlan { matches: MatchPlan[]; heats: HeatPlan[]; walkovers: { std: number; side: string }[] }

/** A side per entry: the student, or the section / class / house for a team sport. Children with no house drop out of a house draw. */
export function sidesOf(sport: Pick<Sport, 'teamSize'>, entries: EntryIn[], basis: TeamBasis = 'SECTIONS'): { side: string; std: number }[] {
  const seen = new Set<string>();
  const out: { side: string; std: number }[] = [];
  for (const e of entries) {
    const side = sideOfEntry(e, sidesAreSections(sport), basis);
    if (!side || seen.has(side)) continue;
    seen.add(side);
    out.push({ side, std: e.std });
  }
  return out;
}

/** The student ids behind a side, for the scheduler's diary. */
export function peopleOfSide(side: string | null, sport: Pick<Sport, 'teamSize'>, entries: EntryIn[], basis: TeamBasis): string[] {
  if (!side) return [];
  return entries.filter((e) => sideOfEntry(e, sidesAreSections(sport), basis) === side).map((e) => e.studentId);
}

export function drawToMatches(stage: 'CLASS' | 'FINAL', groupLabel: string, rounds: DrawMatch[][]): MatchPlan[] {
  const total = rounds.length;
  return rounds.flatMap((round) =>
    round.map((m) => ({
      stage, groupLabel, roundIdx: m.round, roundName: roundName(m.round, total), pos: m.pos,
      aSide: m.a, bSide: m.b, bye: m.bye, winner: m.winner, venueId: null, atMin: null,
    })),
  );
}

export const classLabel = (std: number) => `Class ${std}`;

/**
 * MATCH + CLASS: a shuffled draw per class with two or more sides; a lone side
 * walks over to the final. When no class has anything to play (every class a
 * walkover), the final is built at once — otherwise it is built later, when
 * the last class champion is known. MATCH + DRAW, only one class present, or
 * a team basis of classes or houses: one draw straight to the final.
 * MEASURED: heats by lane count (one heat is the final). JUDGED: one panel round.
 */
export function buildEventPlan(sport: Sport, structure: 'CLASS' | 'DRAW', entries: EntryIn[], seed: number, basis: TeamBasis = 'SECTIONS'): EventPlan {
  const sides = sidesOf(sport, entries, basis);
  if (sport.kind !== 'MATCH') {
    const width = sport.kind === 'JUDGED' ? Math.max(1, sides.length) : sport.lanes ?? 6;
    const heats = planHeats(sides.map((s) => s.side), width).map((h) => ({ kind: h.kind, idx: h.idx, venueId: null, atMin: null, lanes: h.lanes }));
    return { matches: [], heats, walkovers: [] };
  }
  if (sides.length < 2) throw new Error('NEED_TWO_SIDES');
  // classes and houses are already the whole-group sides: class rounds mean nothing for them
  const classRounds = structure === 'CLASS' && !(sidesAreSections(sport) && basis !== 'SECTIONS');
  const plan = classRounds ? planClassStage(sides) : { mode: 'DRAW' as const, classes: [] };
  if (plan.mode === 'DRAW') {
    const { rounds } = buildDraw(shuffle(sides.map((s) => s.side), seed));
    return { matches: drawToMatches('FINAL', 'Final', rounds), heats: [], walkovers: [] };
  }
  const matches: MatchPlan[] = [];
  const walkovers: { std: number; side: string }[] = [];
  plan.classes.forEach((c, i) => {
    if (c.walkover) { walkovers.push({ std: c.std, side: c.walkover }); return; }
    const { rounds } = buildDraw(shuffle(c.sides, seed + i + 1));
    matches.push(...drawToMatches('CLASS', classLabel(c.std), rounds));
  });
  if (matches.length === 0 && walkovers.length >= 2) {
    // every class walked over: the champions are known now, so the final is built now
    const { rounds } = buildDraw(shuffle(walkovers.map((w) => w.side), seed));
    return { matches: drawToMatches('FINAL', 'Final', rounds), heats: [], walkovers };
  }
  return { matches, heats: [], walkovers };
}

/**
 * Put every real (non-bye) match on a venue, group by group, round after round.
 * With a diary, a match waits until everyone in it is free and rested. Mutates the plans.
 */
export function scheduleMatches(matches: MatchPlan[], venueIds: string[], slotMin: number, cursor: Map<string, number>, w: DayWindow, diary?: Diary, people?: (side: string | null) => string[]): void {
  const groups = new Map<string, MatchPlan[]>();
  for (const m of matches) {
    const key = `${m.stage}|${m.groupLabel}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  for (const group of groups.values()) {
    const rounds = Math.max(...group.map((m) => m.roundIdx)) + 1;
    const perRound = Array.from({ length: rounds }, (_, r) => group.filter((m) => m.roundIdx === r && !m.bye));
    const spec = perRound.map((round) => (diary && people ? round.map((m) => [...people(m.aSide), ...people(m.bSide)]) : round.length));
    const slots = planRounds(spec, venueIds, slotMin, cursor, w, diary);
    perRound.forEach((round, r) => round.forEach((m, i) => { m.venueId = slots[r][i].venueId; m.atMin = slots[r][i].atMin; }));
  }
}

export function scheduleHeats(heats: HeatPlan[], venueIds: string[], slotMin: number, cursor: Map<string, number>, w: DayWindow, diary?: Diary): void {
  const spec = diary ? [heats.map((h) => h.lanes.map((l) => l.side.slice(2)))] : [heats.length];
  const slots = planRounds(spec, venueIds, slotMin, cursor, w, diary);
  heats.forEach((h, i) => { h.venueId = slots[0][i].venueId; h.atMin = slots[0][i].atMin; });
}

/** A repeatable seed from an id, so the same draft draws the same bracket. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
