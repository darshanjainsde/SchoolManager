import { describe, it, expect } from 'vitest';
import { clashesOf, groupsOf, peopleOf, sideScore, slotsOf } from './model';
import type { EventDetail, TournamentDetail } from '@/app/app/sports/ui';

const ev = (over: Partial<EventDetail>): EventDetail => ({
  id: 'e1', sportKey: 'badminton', sportName: 'Badminton', kind: 'MATCH', scoring: { type: 'GAMES', label: 'Games', bestOf: 3, to: 21, winBy: 2, cap: 30 }, teamSize: 1, groupKey: 'sen', groupLabel: 'Senior', category: 'Boys',
  structure: 'CLASS', teamBasis: 'SECTIONS', slotMin: 25, lanes: 6, venueIds: ['v1'], order: 0, entries: [], matches: [], heats: [], ...over,
});
const m = (over: Record<string, unknown>) => ({ id: 'm', stage: 'CLASS', groupLabel: 'Class 9', roundIdx: 0, roundName: 'Final', pos: 0, aSide: 's:a', bSide: 's:b', scoreA: [], scoreB: [], winner: null, bye: false, walkover: false, venueId: 'v1', atMin: 600, version: 1, savedAt: null, ...over });
const t = (events: EventDetail[]): TournamentDetail => ({
  id: 't', name: 'Meet', startsOn: '2026-09-15', endsOn: '2026-09-15', grouping: 'BANDS', dayStartMin: 540, dayEndMin: 960, restMin: 15, status: 'LIVE', published: true, version: 1,
  venues: [{ id: 'v1', name: 'Court 1', order: 0 }], events, sideNames: { 's:a': 'Aarav', 's:b': 'Bela', 'c:9-A': '9 A' }, bands: [],
});

describe('tournament view model', () => {
  it('people behind a side: the student, or the entered children of the section', () => {
    const e = ev({ entries: [{ studentId: 'x', side: 'c:9-A', std: 9, section: 'A', houseId: null }, { studentId: 'y', side: 'c:9-B', std: 9, section: 'b', houseId: null }] });
    expect(peopleOf(e, 's:a')).toEqual(['a']);
    expect(peopleOf(e, 'c:9-A')).toEqual(['x']);
    expect(peopleOf(e, 'k:9')).toEqual(['x', 'y']);
    expect(peopleOf({ ...e, entries: [{ ...e.entries[0], houseId: 'h1' }] }, 'h:h1')).toEqual(['x']);
    expect(peopleOf(e, null)).toEqual([]);
  });

  it('slots skip byes and unscheduled rows, sort by time, and name the sides', () => {
    const e = ev({ matches: [m({ id: 'm2', atMin: 700 }), m({ id: 'bye', bye: true, bSide: null }), m({ id: 'm1', atMin: 600, winner: 's:a' }), m({ id: 'later', atMin: null })], heats: [{ id: 'h1', kind: 'HEAT', idx: 0, venueId: 'v1', atMin: 650, done: false, marks: [{ studentId: 'z', side: 's:z', lane: 1, mark: null, rank: null }] }] });
    const slots = slotsOf(t([e]));
    expect(slots.map((s) => [s.id, s.state])).toEqual([['m1', 'done'], ['h1', 'open'], ['m2', 'open']]);
    expect(slots[0]).toMatchObject({ title: 'Badminton · Final (Class 9)', who: 'Aarav v Bela', people: ['a', 'b'] });
    expect(slots[1]).toMatchObject({ title: 'Badminton · Heat 1', who: '1 in lanes', people: ['z'] });
  });

  it('finds a child booked on two courts at once', () => {
    const e1 = ev({ id: 'e1', matches: [m({ id: 'm1', atMin: 600 })] });
    const e2 = ev({ id: 'e2', sportName: 'Chess', matches: [m({ id: 'm2', atMin: 610, venueId: 'v2', aSide: 's:a', bSide: 's:c' })] });
    const clashes = clashesOf(t([e1, e2]));
    expect(clashes).toEqual([{ kind: 'PERSON', who: 'a', first: 'm1', second: 'm2' }]);
  });

  it('groups a class-structured event by class number, final last; scores read per side', () => {
    const e = ev({ matches: [m({ id: 'f', stage: 'FINAL', groupLabel: 'Final' }), m({ id: 'c10', groupLabel: 'Class 10' }), m({ id: 'c9', groupLabel: 'Class 9' })] });
    expect(groupsOf(e).map((g) => g.label)).toEqual(['Class 9', 'Class 10', 'Final']);
    expect(sideScore(e.scoring, [21, 21], [15, 19])).toBe('21 21');
    expect(sideScore({ type: 'SINGLE', label: 'Goals', decider: 'Penalties' }, [1, 4], [1, 3])).toBe('1 (4)');
    expect(sideScore(e.scoring, [], [])).toBe('');
  });
});
