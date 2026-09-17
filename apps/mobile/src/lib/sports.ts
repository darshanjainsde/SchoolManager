import { dayOf, hhmm, type Scoring } from '@skoolos/types';

/**
 * The `/me/sports` payload — the child's own tab (mirrors
 * apps/api/src/modules/sports/internal/sports-me.service.ts and the web's
 * lib/sports-me-types.ts). Pure types plus the three helpers the web tab
 * uses, ported verbatim so both clients say the same thing about a fixture.
 */
export interface MeSportsMatch {
  id: string; stage: string; groupLabel: string; roundName: string; aSide: string | null; bSide: string | null;
  scoreA: number[]; scoreB: number[]; winner: string | null; bye: boolean; walkover: boolean; venue: string | null; atMin: number | null;
}
export interface MeSportsHeat { id: string; kind: 'HEAT' | 'FINAL'; idx: number; venue: string | null; atMin: number | null; done: boolean; lane: number; mark: number | null; rank: number | null }
export interface MeSportsEvent {
  eventId: string; tournamentId: string; sportName: string; kind: 'MATCH' | 'MEASURED' | 'JUDGED'; scoring: Scoring;
  groupLabel: string; category: string; structure: string; side: string; matches: MeSportsMatch[]; heats: MeSportsHeat[];
}
export interface MeSportsTournament { id: string; name: string; startsOn: string; endsOn: string; status: 'DRAFT' | 'LIVE' | 'DONE'; dayStartMin: number; events: MeSportsEvent[]; sideNames: Record<string, string> }
export interface MeSportsRecord { id: string; sportName: string; groupKey: string; category: string; text: string; holderName: string; sinceYear: number; untilYear: number | null; status: string }
export interface MeSportsAttempt { id: string; sportName: string; groupKey: string; category: string; text: string; status: string; source: string; createdAt: string }

/** One row of the house table — the school's standings, every house, points to date. */
export interface MeSportsHouse { id: string; name: string; color: string; points: number; members: number }

export type MeSportsPayload =
  | { role: 'STUDENT'; house: { id: string; name: string; color: string } | null; tournaments: MeSportsTournament[]; records: { records: MeSportsRecord[]; attempts: MeSportsAttempt[] }; houses: MeSportsHouse[] }
  | { role: 'TEACHER'; tournaments: { id: string; name: string; startsOn: string; endsOn: string; status: string }[]; houses: { id: string; name: string; color: string; points: number; members: number }[] };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu 18 Sep, 09:40" — `atMin` counts minutes from the meet's first midnight, so it carries the day too. */
export function when(startsOn: string, atMin: number | null): string {
  if (atMin == null) return 'Time to be announced';
  const d = new Date(Date.parse(`${startsOn}T00:00:00Z`) + dayOf(atMin) * 86_400_000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hhmm(atMin)}`;
}

export const nameOf = (t: MeSportsTournament, side: string | null) => (side ? t.sideNames[side] ?? side : 'to be decided');

export type NextUp = { kind: 'match'; m: MeSportsMatch } | { kind: 'heat'; h: MeSportsHeat } | null;

/** "Next" for an event: the first unplayed match I am in with both sides known, or my first open heat. */
export function nextOf(e: MeSportsEvent): NextUp {
  const m = e.matches.find((x) => !x.winner && !x.bye && x.aSide && x.bSide);
  if (m) return { kind: 'match', m };
  const h = e.heats.find((x) => !x.done);
  if (h) return { kind: 'heat', h };
  return null;
}

export function slotMin(n: NextUp): number | null {
  if (!n) return null;
  return n.kind === 'match' ? n.m.atMin : n.h.atMin;
}

export function scoreline(e: MeSportsEvent, m: MeSportsMatch): string {
  const mine = m.aSide === e.side ? m.scoreA : m.scoreB;
  const theirs = m.aSide === e.side ? m.scoreB : m.scoreA;
  if (!mine.length) return m.walkover ? 'walkover' : '';
  return e.scoring.type === 'GAMES'
    ? mine.map((x, i) => `${x}-${theirs[i]}`).join(' ')
    : mine.length > 1 ? `${mine[0]}-${theirs[0]} (${mine[1]}-${theirs[1]})` : `${mine[0]}-${theirs[0]}`;
}

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** Where my house stands: houses sorted by points, ties share a place. */
export function standingOf(houses: MeSportsHouse[], id: string): { place: number; of: number } | null {
  if (!houses.length) return null;
  const sorted = [...houses].sort((a, b) => b.points - a.points);
  const i = sorted.findIndex((h) => h.id === id);
  if (i < 0) return null;
  const place = sorted.findIndex((h) => h.points === sorted[i].points) + 1;
  return { place, of: sorted.length };
}
