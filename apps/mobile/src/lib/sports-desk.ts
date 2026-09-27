import { formatMark, hhmm, dayOf, type Scoring } from '@skoolos/types';

/**
 * THE SPORTS DESK — response shapes of `/sports/*` as the desk reads them
 * (mirrors apps/api/src/modules/sports/internal/sports-tournaments.service.ts,
 * sports-records.service.ts and sports-houses.service.ts). Types are local to
 * the client, the same convention as lib/sports.ts for the child's tab.
 */
export type SportsPerm = 'ENTER' | 'VERIFY' | 'CREATE' | 'PUBLISH' | 'HOUSES' | 'SETTINGS';
export interface DeskMe { perms: SportsPerm[]; isAdmin: boolean }
export const can = (me: DeskMe | null | undefined, p: SportsPerm) => !!me && (me.isAdmin || me.perms.includes(p));

export interface TournamentRow { id: string; name: string; startsOn: string; endsOn: string; status: 'DRAFT' | 'LIVE' | 'DONE' | string; published: boolean; version: number; events: number }

export interface MatchRow {
  id: string; stage: string; groupLabel: string; roundIdx: number; roundName: string; pos: number; aSide: string | null; bSide: string | null;
  scoreA: number[]; scoreB: number[]; winner: string | null; bye: boolean; walkover: boolean; venueId: string | null; atMin: number | null; version: number; savedAt: string | null;
}
export interface HeatMark { studentId: string; side: string; lane: number; mark: number | null; rank: number | null }
export interface HeatRow { id: string; kind: 'HEAT' | 'FINAL'; groupLabel: string | null; idx: number; venueId: string | null; atMin: number | null; done: boolean; marks: HeatMark[] }
export interface EventDetail {
  id: string; sportKey: string; sportName: string; kind: 'MATCH' | 'MEASURED' | 'JUDGED'; scoring: Scoring; teamSize: number; groupKey: string; groupLabel: string; category: string;
  structure: string; dayIdx: number | null; slotMin: number; lanes: number; venueIds: string[]; order: number;
  entries: { studentId: string; side: string; std: number; section: string; houseId: string | null }[];
  matches: MatchRow[]; heats: HeatRow[];
}
export interface TournamentDetail {
  id: string; name: string; startsOn: string; endsOn: string; grouping: string; dayStartMin: number; dayEndMin: number; status: string; published: boolean; version: number;
  venues: { id: string; name: string; order: number }[]; events: EventDetail[]; sideNames: Record<string, string>;
}
export interface RosterStudent { id: string; name: string; std: number; section: string; gender: string | null; dob: string | null; houseId: string | null }

export interface RecordView {
  id: string; sportKey: string; sportName: string; groupKey: string; category: string; value: number; unit: string; text: string;
  holderName: string; holderStudentId: string | null; setOn: string | null; sinceYear: number; untilYear: number | null; status: string; source: string; note: string | null;
}
export interface AttemptView {
  id: string; sportKey: string; sportName: string; groupKey: string; category: string; value: number; unit: string; text: string;
  source: 'PRACTICE' | 'TRIAL'; witnessed: boolean; createdAt: string;
  student: { id: string; name: string; classLabel: string };
}
export interface HouseRow { id: string; name: string; color: string; order: number; members: number; points: number }
export interface PointRow { id: string; houseId: string; points: number; reason: string; eventId: string | null; createdAt: string }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu 18 Sep, 09:40" — same words the child's tab uses for the same slot. */
export function when(startsOn: string, atMin: number | null): string {
  if (atMin == null) return 'Time to be announced';
  const d = new Date(Date.parse(`${startsOn}T00:00:00Z`) + dayOf(atMin) * 86_400_000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hhmm(atMin)}`;
}

export const sideName = (t: Pick<TournamentDetail, 'sideNames'>, side: string | null) => (side ? t.sideNames[side] ?? side : 'to be decided');

/** "21-15 19-21 21-18" — a hyphenated figure, so the caller must keep it on one line. */
export function scoreline(m: Pick<MatchRow, 'scoreA' | 'scoreB' | 'walkover' | 'bye'>): string {
  if (m.bye) return 'bye';
  if (m.walkover) return 'walkover';
  if (!m.scoreA.length && !m.scoreB.length) return '';
  return m.scoreA.map((a, i) => `${a}‑${m.scoreB[i] ?? 0}`).join('  ');
}

export const markText = (scoring: Scoring, v: number | null | undefined) => (scoring.type === 'MARK' ? formatMark(scoring, v) : v == null ? '' : String(v));

/** What is still to be done on a meet: unplayed real matches + open heats. */
export function openWork(t: TournamentDetail): { matches: number; heats: number } {
  let matches = 0;
  let heats = 0;
  for (const e of t.events) {
    matches += e.matches.filter((m) => !m.winner && !m.bye && m.aSide && m.bSide).length;
    heats += e.heats.filter((h) => !h.done).length;
  }
  return { matches, heats };
}

/** The desk's "now": the earliest unplayed slot with a time, or null. */
export function nextSlot(t: TournamentDetail): { event: EventDetail; atMin: number; label: string } | null {
  let best: { event: EventDetail; atMin: number; label: string } | null = null;
  for (const e of t.events) {
    for (const m of e.matches) {
      if (m.winner || m.bye || m.atMin == null) continue;
      if (!best || m.atMin < best.atMin) best = { event: e, atMin: m.atMin, label: `${sideName(t, m.aSide)} v ${sideName(t, m.bSide)}` };
    }
    for (const h of e.heats) {
      if (h.done || h.atMin == null) continue;
      if (!best || h.atMin < best.atMin) best = { event: e, atMin: h.atMin, label: `${h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`}${h.groupLabel ? ` · ${h.groupLabel}` : ''}` };
    }
  }
  return best;
}

/** Group events by the noun a teacher says: "the 100 m" first, then "for Senior Girls". */
export function bySport(events: EventDetail[]): { sport: string; events: EventDetail[] }[] {
  const map = new Map<string, EventDetail[]>();
  for (const e of [...events].sort((a, b) => a.order - b.order)) map.set(e.sportName, [...(map.get(e.sportName) ?? []), e]);
  return [...map.entries()].map(([sport, evs]) => ({ sport, events: evs }));
}

export const groupLine = (e: Pick<EventDetail, 'groupLabel' | 'category'>) => `${e.groupLabel} ${e.category}`;

/** Standing: the leader first; ties share a place. */
export function standings(houses: HouseRow[]): (HouseRow & { place: number })[] {
  const sorted = [...houses].sort((a, b) => b.points - a.points || a.order - b.order);
  let place = 0;
  let last: number | null = null;
  return sorted.map((h, i) => {
    if (h.points !== last) { place = i + 1; last = h.points; }
    return { ...h, place };
  });
}
