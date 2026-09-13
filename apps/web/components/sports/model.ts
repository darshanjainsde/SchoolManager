/**
 * Pure view helpers for a tournament payload — bookings for the clash finder,
 * the day board's rows, the words on a match card. No React; `model.test.ts`.
 */
import { dayOf, findClashes, hhmm, minuteOfDay, parseSide, type Booking, type Clash, type Scoring } from '@skoolos/types';
import type { EventDetail, MatchRow, TournamentDetail } from '@/app/app/sports/ui';

export interface Slot {
  id: string; kind: 'match' | 'heat'; eventId: string; event: EventDetail; venueId: string; atMin: number; slotMin: number;
  title: string; who: string; state: 'done' | 'open'; people: string[];
}

export const eventLabel = (e: EventDetail) => `${e.sportName} · ${e.groupLabel} ${e.category}`;

/** Student ids behind a side: the student, or every entered child of the section. */
export function peopleOf(event: EventDetail, side: string | null): string[] {
  if (!side) return [];
  const p = parseSide(side);
  if (!p) return [];
  if (p.kind === 'student') return [p.studentId];
  if (p.kind === 'class') return event.entries.filter((e) => e.std === p.std).map((e) => e.studentId);
  if (p.kind === 'house') return event.entries.filter((e) => e.houseId === p.houseId).map((e) => e.studentId);
  return event.entries.filter((e) => e.std === p.std && e.section.trim().toUpperCase() === p.section).map((e) => e.studentId);
}

export function slotsOf(t: TournamentDetail): Slot[] {
  const out: Slot[] = [];
  for (const ev of t.events) {
    for (const m of ev.matches) {
      if (m.bye || m.atMin == null || !m.venueId) continue;
      out.push({
        id: m.id, kind: 'match', eventId: ev.id, event: ev, venueId: m.venueId, atMin: m.atMin, slotMin: ev.slotMin,
        title: `${ev.sportName} · ${m.roundName}${m.groupLabel !== 'Final' ? ` (${m.groupLabel})` : ''}`,
        who: `${nameOf(t, m.aSide)} v ${nameOf(t, m.bSide)}`, state: m.winner ? 'done' : 'open',
        people: [...peopleOf(ev, m.aSide), ...peopleOf(ev, m.bSide)],
      });
    }
    for (const h of ev.heats) {
      if (h.atMin == null || !h.venueId) continue;
      out.push({
        id: h.id, kind: 'heat', eventId: ev.id, event: ev, venueId: h.venueId, atMin: h.atMin, slotMin: ev.slotMin,
        title: `${ev.sportName} · ${h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`}`,
        who: `${h.marks.length} in lanes`, state: h.done ? 'done' : 'open', people: h.marks.map((k) => k.studentId),
      });
    }
  }
  return out.sort((a, b) => a.atMin - b.atMin);
}

export function bookingsOf(slots: Slot[]): Booking[] {
  return slots.map((s) => ({ id: s.id, people: s.people, venueId: s.venueId, atMin: s.atMin, slotMin: s.slotMin }));
}

export function clashesOf(t: TournamentDetail): Clash[] {
  return findClashes(bookingsOf(slotsOf(t)));
}

export const nameOf = (t: Pick<TournamentDetail, 'sideNames'>, side: string | null) => (side ? t.sideNames[side] ?? side : 'TBD');

/** "21 21" for games; "2" (or "1 (4)" with a decider) for a single number. */
export function sideScore(scoring: Scoring, mine: number[], theirs: number[]): string {
  if (!mine.length) return '';
  if (scoring.type === 'GAMES') return mine.join(' ');
  return mine.length > 1 ? `${mine[0]} (${mine[1]})` : String(mine[0]);
}

/** The groups of a match event in bracket order: class rounds by class number, then the final. */
export function groupsOf(event: EventDetail): { key: string; label: string; matches: MatchRow[] }[] {
  const map = new Map<string, MatchRow[]>();
  for (const m of event.matches) {
    const key = `${m.stage}|${m.groupLabel}`;
    map.set(key, [...(map.get(key) ?? []), m]);
  }
  return [...map.entries()]
    .map(([key, matches]) => ({ key, label: matches[0].groupLabel, matches, stage: matches[0].stage, std: Number(/\d+/.exec(matches[0].groupLabel)?.[0] ?? 0) }))
    .sort((a, b) => (a.stage === b.stage ? a.std - b.std : a.stage === 'FINAL' ? 1 : -1));
}

export const whenOf = (atMin: number | null) => (atMin == null ? 'not scheduled' : hhmm(atMin));

/**
 * The days the meet is booked for, and the days its slots actually reach.
 * `fitInDay` rolls a slot that will not finish before the bell onto the next
 * morning, so a one-day meet can hold slots on day 2 — which the board must
 * show rather than hide, or a court reads as free all day when it is not.
 */
export function daySpanOf(t: TournamentDetail): { booked: number; used: number; over: boolean } {
  const a = Date.parse(`${t.startsOn}T00:00:00Z`);
  const b = Date.parse(`${t.endsOn}T00:00:00Z`);
  const booked = Number.isNaN(a) || Number.isNaN(b) ? 1 : Math.max(1, Math.round((b - a) / 86_400_000) + 1);
  const used = slotsOf(t).reduce((n, s) => Math.max(n, dayOf(s.atMin) + 1), 1);
  return { booked, used, over: used > booked };
}

export interface DayLoad {
  day: number;
  /** Minutes booked across every venue. */
  total: number;
  byVenue: Record<string, { min: number; slots: number }>;
  /** The minute of the day the last slot finishes, or null when the day is empty. */
  endsAt: number | null;
  /** Events with a slot on this day, in the order they first appear. */
  events: { id: string; label: string; slots: number }[];
}

/** What each day of the meet holds: minutes per venue, when it ends, whose events run. */
export function loadOf(t: TournamentDetail, days: number): DayLoad[] {
  const out: DayLoad[] = Array.from({ length: Math.max(1, days) }, (_, day) => ({ day, total: 0, byVenue: {}, endsAt: null, events: [] }));
  for (const s of slotsOf(t)) {
    const d = out[dayOf(s.atMin)];
    if (!d) continue;
    const v = (d.byVenue[s.venueId] ??= { min: 0, slots: 0 });
    v.min += s.slotMin;
    v.slots += 1;
    d.total += s.slotMin;
    d.endsAt = Math.max(d.endsAt ?? 0, minuteOfDay(s.atMin) + s.slotMin);
    const e = d.events.find((x) => x.id === s.eventId);
    if (e) e.slots += 1;
    else d.events.push({ id: s.eventId, label: eventLabel(s.event), slots: 1 });
  }
  return out;
}
