/**
 * The wizard's state and the pure rules around it — what the defaults bar
 * decides for every event, which venues an event takes, who is eligible, what
 * a team is, and what still stops Create. No React, no fetching:
 * `wizard-model.test.ts` pins every rule.
 */
import {
  AGE_GROUPS, ageGroupFor, bandFor, inferVenueType, sidesAreSections, suggestTeamBasis, venuesForSport,
  type Band, type Sport, type SportCategory, type TeamBasis, type VenueType,
} from '@skoolos/types';
import { genderBucket, type RosterStudent } from './ui';

export interface WizardVenue { name: string; type: VenueType }

export interface WizardEvent {
  /** Stable key for React; not sent. */
  uid: string;
  sport: Sport;
  category: SportCategory;
  /** Set only when the line differs from the defaults bar. */
  groupKey?: string;
  structure?: 'CLASS' | 'DRAW';
  slotMin?: number;
  lanes?: number;
  /** Venue indexes chosen by hand; absent = bound from the sport. */
  venueIdx?: number[];
  /** Team sports: what a side is; absent = suggested from the entrants. */
  teamBasis?: TeamBasis;
  studentIds: string[];
}

export interface WizardDefaults { groupKey: string; categories: SportCategory[]; structure: 'CLASS' | 'DRAW' }

export interface WizardState {
  name: string;
  startsOn: string;
  endsOn: string;
  dayStartMin: number;
  dayEndMin: number;
  restMin: number;
  venues: WizardVenue[];
  defaults: WizardDefaults;
  events: WizardEvent[];
}

export interface GroupOption { id: string; label: string }

let seq = 0;
export const nextUid = () => `ev${++seq}`;

export function emptyState(today: string): WizardState {
  return { name: '', startsOn: today, endsOn: today, dayStartMin: 540, dayEndMin: 960, restMin: 15, venues: [], defaults: { groupKey: '', categories: ['Boys', 'Girls'], structure: 'CLASS' }, events: [] };
}

export function groupOptions(grouping: 'BANDS' | 'AGE', bands: Band[]): GroupOption[] {
  return grouping === 'AGE' ? AGE_GROUPS.map((g) => ({ id: g.id, label: g.label })) : bands.map((b) => ({ id: b.id, label: b.label }));
}

export const makeVenue = (name: string): WizardVenue => ({ name: name.trim(), type: inferVenueType(name) });

/** Pressing a sport adds one line per default category; pressing it again removes every line of that sport. */
export function toggleSport(state: WizardState, sport: Sport): WizardState {
  if (state.events.some((e) => e.sport.key === sport.key)) return { ...state, events: state.events.filter((e) => e.sport.key !== sport.key) };
  const cats = state.defaults.categories.filter((c) => sport.categories.includes(c));
  const added = (cats.length ? cats : [sport.categories[0]]).map((category): WizardEvent => ({ uid: nextUid(), sport, category, studentIds: [] }));
  return { ...state, events: [...state.events, ...added] };
}

/** The values a line runs with: its own, else the defaults bar's. */
export function resolved(state: WizardState, ev: WizardEvent) {
  const group = ev.groupKey ?? state.defaults.groupKey;
  const structure = ev.sport.kind === 'MATCH' ? ev.structure ?? state.defaults.structure : 'DRAW';
  const slotMin = ev.slotMin ?? ev.sport.slotMin;
  const lanes = ev.lanes ?? ev.sport.lanes ?? 6;
  const venues = ev.venueIdx ? { idx: ev.venueIdx, how: 'chosen' as const, want: venuesForSport(ev.sport, state.venues).want } : boundVenues(state, ev.sport);
  return { group, structure, slotMin, lanes, venues };
}

/** Which of the meet's venues a sport takes by default, as indexes into `state.venues`. */
export function boundVenues(state: WizardState, sport: Sport): { idx: number[]; how: 'named' | 'type' | 'fallback' | 'none'; want: VenueType } {
  const r = venuesForSport(sport, state.venues.map((v, i) => ({ ...v, i })));
  return { idx: r.list.map((v) => v.i), how: r.how, want: r.want };
}

/** The group a child belongs to under the school's grouping, or null when they fit none. */
export function groupOf(s: RosterStudent, grouping: 'BANDS' | 'AGE', bands: Band[], meetYear: number): string | null {
  if (grouping === 'AGE') return s.dob ? ageGroupFor(new Date(`${s.dob}T00:00:00Z`), meetYear)?.id ?? null : null;
  return bandFor(bands, s.std)?.id ?? null;
}

/** Who may be entered: in the group, and of the category (Mixed takes everyone; an unknown gender is offered under both). */
export function eligible(roster: RosterStudent[], groupKey: string, category: SportCategory, grouping: 'BANDS' | 'AGE', bands: Band[], meetYear: number): RosterStudent[] {
  return roster.filter((s) => {
    if (groupOf(s, grouping, bands, meetYear) !== groupKey) return false;
    if (category === 'Mixed') return true;
    const g = genderBucket(s.gender);
    return g === null || g === category;
  });
}

export const meetYearOf = (startsOn: string) => Number(startsOn.slice(0, 4)) || new Date().getUTCFullYear();

export const isTeam = (ev: WizardEvent) => sidesAreSections(ev.sport);

/** The team basis a line runs with: its own, else what its entrants suggest. */
export function basisOf(ev: WizardEvent, roster: RosterStudent[]): TeamBasis {
  if (ev.teamBasis) return ev.teamBasis;
  return suggestTeamBasis(roster.filter((s) => ev.studentIds.includes(s.id)).map((s) => ({ std: s.std, section: s.section })));
}

/** How many teams each basis would make from the children ticked so far. */
export function teamCounts(ev: WizardEvent, roster: RosterStudent[]): Record<TeamBasis, number> {
  const chosen = roster.filter((s) => ev.studentIds.includes(s.id));
  return {
    SECTIONS: new Set(chosen.map((s) => `${s.std}-${s.section.trim().toUpperCase()}`)).size,
    CLASSES: new Set(chosen.map((s) => s.std)).size,
    HOUSES: new Set(chosen.map((s) => s.houseId).filter(Boolean)).size,
  };
}

/** Sides an event will have with the students chosen so far — players, or the teams under its basis. */
export function sideCount(ev: WizardEvent, roster: RosterStudent[]): number {
  if (!isTeam(ev)) return roster.filter((s) => ev.studentIds.includes(s.id)).length;
  return teamCounts(ev, roster)[basisOf(ev, roster)];
}

/** A basis that WOULD give at least two teams from the same children — null when the chosen one already works. */
export function fixBasis(ev: WizardEvent, roster: RosterStudent[]): TeamBasis | null {
  const counts = teamCounts(ev, roster);
  const basis = basisOf(ev, roster);
  if (counts[basis] >= 2) return null;
  return (['SECTIONS', 'CLASSES', 'HOUSES'] as TeamBasis[]).find((b) => b !== basis && counts[b] >= 2) ?? null;
}

/** Classes in the entrants with a single section — under class rounds their team walks over into the final. */
export function singleSectionClasses(ev: WizardEvent, roster: RosterStudent[]): number[] {
  const byStd = new Map<number, Set<string>>();
  for (const s of roster.filter((x) => ev.studentIds.includes(x.id))) byStd.set(s.std, (byStd.get(s.std) ?? new Set()).add(s.section.trim().toUpperCase()));
  return [...byStd.entries()].filter(([, secs]) => secs.size < 2).map(([std]) => std).sort((a, b) => a - b);
}

export function daysOf(state: Pick<WizardState, 'startsOn' | 'endsOn'>): number {
  const a = Date.parse(`${state.startsOn}T00:00:00Z`);
  const b = Date.parse(`${state.endsOn}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

export const lineLabel = (ev: WizardEvent) => `${ev.sport.name} ${ev.category}`;

/** The word each basis is called in a sentence. */
export const TEAM_BASIS_WORD: Record<TeamBasis, string> = { SECTIONS: 'sections', CLASSES: 'classes', HOUSES: 'houses' };

/** What still stops Create — one line per problem, in the order the steps fix them. */
export function problems(state: WizardState, roster: RosterStudent[], groups: GroupOption[]): string[] {
  const out: string[] = [];
  if (!state.name.trim()) out.push('Give the meet a name.');
  const days = daysOf(state);
  if (days < 1) out.push('The last day cannot be before the first.');
  if (days > 14) out.push('A meet runs for at most 14 days.');
  if (state.dayEndMin - state.dayStartMin < 60) out.push('A day needs at least an hour.');
  if (state.venues.length === 0) out.push('Add at least one venue (a court, a field, the track).');
  if (state.events.length === 0) out.push('Press at least one sport.');
  for (const ev of state.events) {
    const r = resolved(state, ev);
    const label = lineLabel(ev);
    if (!groups.some((g) => g.id === r.group)) out.push(`${label}: choose a group.`);
    if (r.venues.idx.length === 0) out.push(`${label}: no ${r.venues.want} in the venues — add one, or tick a venue on the line.`);
    const n = sideCount(ev, roster);
    if (ev.sport.kind === 'MATCH' && isTeam(ev)) {
      if (ev.studentIds.length === 0) out.push(`${label}: nobody entered yet.`);
      else if (n < 2) {
        const basis = basisOf(ev, roster);
        const fix = fixBasis(ev, roster);
        out.push(`${label}: only ${n} team${n === 1 ? '' : 's'} under ${TEAM_BASIS_WORD[basis]}. ${fix ? `Make the teams ${TEAM_BASIS_WORD[fix]} instead.` : 'Tick children from another class or section, or put them in houses first.'}`);
      }
    } else if (ev.sport.kind === 'MATCH' && n < 2) out.push(`${label}: needs at least two players (has ${n}).`);
    else if (ev.sport.kind !== 'MATCH' && n < 1) out.push(`${label}: enter at least one athlete.`);
  }
  return out;
}

export function toDto(state: WizardState, roster: RosterStudent[]) {
  return {
    name: state.name.trim(), startsOn: state.startsOn, endsOn: state.endsOn, dayStartMin: state.dayStartMin, dayEndMin: state.dayEndMin, restMin: state.restMin,
    venues: state.venues.map((v) => ({ name: v.name })),
    events: state.events.map((ev) => {
      const r = resolved(state, ev);
      const custom = ev.sport.key.startsWith('custom:');
      const parts = ev.sport.key.split(':');
      return {
        ...(custom ? { sportKey: 'custom', customName: ev.sport.name, presetKey: parts[1], teamSize: ev.sport.teamSize, ...(parts.length === 5 ? { customVenue: parts[3] } : {}) } : { sportKey: ev.sport.key }),
        groupKey: r.group, category: ev.category, structure: r.structure, venueIdx: r.venues.idx, studentIds: ev.studentIds,
        ...(isTeam(ev) ? { teamBasis: basisOf(ev, roster) } : {}),
        ...(r.slotMin !== ev.sport.slotMin ? { slotMin: r.slotMin } : {}),
        ...(ev.sport.kind !== 'MATCH' && r.lanes !== (ev.sport.lanes ?? 6) ? { lanes: r.lanes } : {}),
      };
    }),
  };
}

export const hhmmToMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const minToHhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
