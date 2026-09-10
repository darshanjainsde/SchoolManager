/**
 * The wizard's state and the pure rules around it — who is eligible for an
 * event, what the API body looks like, what is still missing. No React, no
 * fetching: `wizard-model.test.ts` pins every rule.
 */
import { AGE_GROUPS, ageGroupFor, bandFor, sidesAreSections, type Band, type Sport, type SportCategory } from '@skoolos/types';
import { genderBucket, type RosterStudent } from './ui';

export interface WizardEvent {
  /** Stable key for React; not sent. */
  uid: string;
  sport: Sport;
  groupKey: string;
  category: SportCategory;
  structure: 'CLASS' | 'DRAW';
  venueIdx: number[];
  slotMin: number;
  lanes: number;
  studentIds: string[];
}

export interface WizardState {
  name: string;
  startsOn: string;
  endsOn: string;
  dayStartMin: number;
  dayEndMin: number;
  venues: string[];
  events: WizardEvent[];
}

export interface GroupOption { id: string; label: string }

let seq = 0;
export const nextUid = () => `ev${++seq}`;

export function emptyState(today: string): WizardState {
  return { name: '', startsOn: today, endsOn: today, dayStartMin: 540, dayEndMin: 960, venues: [], events: [] };
}

export function groupOptions(grouping: 'BANDS' | 'AGE', bands: Band[]): GroupOption[] {
  return grouping === 'AGE' ? AGE_GROUPS.map((g) => ({ id: g.id, label: g.label })) : bands.map((b) => ({ id: b.id, label: b.label }));
}

/** A fresh event for a sport: the first group, Boys, class rounds when the sport plays matches, every venue. */
export function newEvent(sport: Sport, groups: GroupOption[], venueCount: number): WizardEvent {
  return {
    uid: nextUid(), sport, groupKey: groups[0]?.id ?? '', category: sport.categories[0] ?? 'Boys', structure: sport.kind === 'MATCH' ? 'CLASS' : 'DRAW',
    venueIdx: Array.from({ length: venueCount }, (_, i) => i), slotMin: sport.slotMin, lanes: sport.lanes ?? 6, studentIds: [],
  };
}

/** The group a child belongs to under the school's grouping, or null when they fit none. */
export function groupOf(s: RosterStudent, grouping: 'BANDS' | 'AGE', bands: Band[], meetYear: number): string | null {
  if (grouping === 'AGE') return s.dob ? ageGroupFor(new Date(`${s.dob}T00:00:00Z`), meetYear)?.id ?? null : null;
  return bandFor(bands, s.std)?.id ?? null;
}

/** Who may be entered: in the group, and of the category (Mixed takes everyone; an unknown gender is offered under both). */
export function eligible(roster: RosterStudent[], ev: Pick<WizardEvent, 'groupKey' | 'category'>, grouping: 'BANDS' | 'AGE', bands: Band[], meetYear: number): RosterStudent[] {
  return roster.filter((s) => {
    if (groupOf(s, grouping, bands, meetYear) !== ev.groupKey) return false;
    if (ev.category === 'Mixed') return true;
    const g = genderBucket(s.gender);
    return g === null || g === ev.category;
  });
}

export const meetYearOf = (startsOn: string) => Number(startsOn.slice(0, 4)) || new Date().getUTCFullYear();

/** Sides an event will have with the students chosen so far — players, or sections for a team sport. */
export function sideCount(ev: WizardEvent, roster: RosterStudent[]): number {
  const chosen = roster.filter((s) => ev.studentIds.includes(s.id));
  if (!sidesAreSections(ev.sport)) return chosen.length;
  return new Set(chosen.map((s) => `${s.std}-${s.section}`)).size;
}

export function daysOf(state: Pick<WizardState, 'startsOn' | 'endsOn'>): number {
  const a = Date.parse(`${state.startsOn}T00:00:00Z`);
  const b = Date.parse(`${state.endsOn}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** What still stops Create — one line per problem, in the order the steps fix them. */
export function problems(state: WizardState, roster: RosterStudent[]): string[] {
  const out: string[] = [];
  if (!state.name.trim()) out.push('Give the meet a name.');
  const days = daysOf(state);
  if (days < 1) out.push('The last day cannot be before the first.');
  if (days > 14) out.push('A meet runs for at most 14 days.');
  if (state.dayEndMin - state.dayStartMin < 60) out.push('A day needs at least an hour.');
  if (state.venues.length === 0) out.push('Add at least one venue (a court, a field, the track).');
  if (state.events.length === 0) out.push('Pick at least one sport.');
  for (const ev of state.events) {
    const label = `${ev.sport.name} ${ev.category}`;
    if (ev.venueIdx.length === 0) out.push(`${label}: choose a venue.`);
    const n = sideCount(ev, roster);
    if (ev.sport.kind === 'MATCH' && n < 2) out.push(`${label}: needs at least two ${sidesAreSections(ev.sport) ? 'sections' : 'players'} (has ${n}).`);
    if (ev.sport.kind !== 'MATCH' && n < 1) out.push(`${label}: enter at least one athlete.`);
  }
  return out;
}

export function toDto(state: WizardState) {
  return {
    name: state.name.trim(), startsOn: state.startsOn, endsOn: state.endsOn, dayStartMin: state.dayStartMin, dayEndMin: state.dayEndMin,
    venues: state.venues.map((name) => ({ name })),
    events: state.events.map((ev) => ({
      ...(ev.sport.key.startsWith('custom:')
        ? { sportKey: 'custom', customName: ev.sport.name, presetKey: ev.sport.key.split(':')[1], teamSize: ev.sport.teamSize }
        : { sportKey: ev.sport.key }),
      groupKey: ev.groupKey, category: ev.category, structure: ev.structure, venueIdx: ev.venueIdx, studentIds: ev.studentIds,
      ...(ev.slotMin !== ev.sport.slotMin ? { slotMin: ev.slotMin } : {}),
      ...(ev.sport.kind !== 'MATCH' && ev.lanes !== (ev.sport.lanes ?? 6) ? { lanes: ev.lanes } : {}),
    })),
  };
}

export const hhmmToMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const minToHhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
