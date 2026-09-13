import { describe, it, expect } from 'vitest';
import { clashesOf, dayIndexOf, daySpanOf, groupsOf, loadOf, peopleOf, scheduleOf, sideScore, slotsOf, timetableOf, toneMap } from './model';
import type { EventDetail, TournamentDetail } from '@/app/app/sports/ui';

const ev = (over: Partial<EventDetail>): EventDetail => ({
  id: 'e1', sportKey: 'badminton', sportName: 'Badminton', kind: 'MATCH', scoring: { type: 'GAMES', label: 'Games', bestOf: 3, to: 21, winBy: 2, cap: 30 }, teamSize: 1, groupKey: 'sen', groupLabel: 'Senior', category: 'Boys',
  structure: 'CLASS', teamBasis: 'SECTIONS', stageShape: 'CLASS_QUAL', advancePerClass: 2, finalists: 6, dayIdx: null, slotMin: 25, lanes: 6, venueIds: ['v1'], order: 0, entries: [], matches: [], heats: [], ...over,
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
    const e = ev({ matches: [m({ id: 'm2', atMin: 700 }), m({ id: 'bye', bye: true, bSide: null }), m({ id: 'm1', atMin: 600, winner: 's:a' }), m({ id: 'later', atMin: null })], heats: [{ id: 'h1', kind: 'HEAT', groupLabel: null, idx: 0, venueId: 'v1', atMin: 650, done: false, marks: [{ studentId: 'z', side: 's:z', lane: 1, mark: null, rank: null }] }] });
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

describe('the days a meet reaches, and what each one holds', () => {
  const oneDay = (over: Partial<TournamentDetail>): TournamentDetail => ({ ...t([]), ...over });
  it('counts the days booked and the days the slots actually reach', () => {
    const e = ev({ matches: [m({ id: 'm1', atMin: 600 }), m({ id: 'spill', atMin: 1440 + 600 })] });
    expect(daySpanOf(oneDay({ events: [e] }))).toEqual({ booked: 1, used: 2, over: true });
    expect(daySpanOf(oneDay({ events: [e], endsOn: '2026-09-16' }))).toEqual({ booked: 2, used: 2, over: false });
    expect(daySpanOf(oneDay({ events: [ev({})] }))).toEqual({ booked: 1, used: 1, over: false });
  });

  it('adds up each venue, when the day ends, and which events run that day', () => {
    const a = ev({ id: 'e1', matches: [m({ id: 'm1', atMin: 600 }), m({ id: 'm2', atMin: 630 })] });
    const b = ev({ id: 'e2', sportName: 'Chess', matches: [m({ id: 'm3', atMin: 1440 + 540, venueId: 'v2' })] });
    const load = loadOf(oneDay({ events: [a, b], venues: [{ id: 'v1', name: 'Court 1', order: 0 }, { id: 'v2', name: 'Court 2', order: 1 }] }), 2);
    expect(load[0]).toMatchObject({ day: 0, total: 50, endsAt: 655 });
    expect(load[0].byVenue).toEqual({ v1: { min: 50, slots: 2 } });
    expect(load[0].events).toEqual([{ id: 'e1', label: 'Badminton · Senior Boys', slots: 2 }]);
    expect(load[1]).toMatchObject({ day: 1, total: 25, endsAt: 565 });
    expect(load[1].byVenue).toEqual({ v2: { min: 25, slots: 1 } });
    expect(loadOf(oneDay({ events: [a, b] }), 1)).toHaveLength(1); // a day past the count is simply not listed
  });
});

describe('the meet the way a teacher asks for it', () => {
  const sprint = (over: Partial<EventDetail> = {}): EventDetail => ev({
    id: 'e-run', sportKey: 'ath-100m', sportName: '100 m sprint', kind: 'MEASURED', slotMin: 5, venueIds: ['v2'],
    heats: [
      { id: 'h1', kind: 'HEAT', groupLabel: 'Class 9', idx: 0, venueId: 'v2', atMin: 540, done: true, marks: [{ studentId: 'a', side: 's:a', lane: 1, mark: 13.1, rank: 1 }] },
      { id: 'h2', kind: 'HEAT', groupLabel: 'Class 9', idx: 1, venueId: 'v2', atMin: 545, done: false, marks: [{ studentId: 'b', side: 's:b', lane: 1, mark: null, rank: null }] },
      { id: 'h3', kind: 'HEAT', groupLabel: 'Class 10', idx: 2, venueId: 'v2', atMin: 550, done: false, marks: [{ studentId: 'c', side: 's:c', lane: 1, mark: null, rank: null }] },
      { id: 'hf', kind: 'FINAL', groupLabel: null, idx: 3, venueId: 'v2', atMin: 1440 + 600, done: false, marks: [{ studentId: 'a', side: 's:a', lane: 1, mark: null, rank: null }] },
    ],
    ...over,
  });
  const meet = (over: Partial<TournamentDetail> = {}): TournamentDetail => ({
    ...t([]),
    venues: [{ id: 'v1', name: 'Court 1', order: 0 }, { id: 'v2', name: 'Track', order: 1 }, { id: 'v3', name: 'Pool', order: 2 }],
    events: [sprint(), ev({ id: 'e-bad', matches: [m({ id: 'm1', atMin: 600 }), m({ id: 'm2', atMin: 625, groupLabel: 'Final', roundName: 'Final' })] })],
    ...over,
  });

  it('groups by sport, then by the class or round inside it, with counts and when it runs', () => {
    const [run, bad] = scheduleOf(meet());
    expect(run).toMatchObject({ label: '100 m sprint · Senior Boys', total: 4, done: 1, venueIds: ['v2'] });
    expect(run.groups.map((g) => [g.label, g.slots.length])).toEqual([['Class 9', 2], ['Class 10', 1], ['Final', 1]]);
    expect(run.groups[0]).toMatchObject({ fromMin: 540, toMin: 550, done: 1 });
    expect(run.toMin).toBe(1440 + 605); // the final is on the second day
    // a match event groups by the class its round belongs to
    expect(bad.groups.map((g) => g.label)).toEqual(['Class 9', 'Final']);
    expect(bad.groups[0].slots[0].short).toBe('Final');
    // one colour per sport, in the order the sports appear
    expect([...toneMap(meet()).entries()]).toEqual([['ath-100m', 0], ['badminton', 1]]);
  });

  it('offers every day the meet booked plus every day a slot reached, with what is on each', () => {
    expect(dayIndexOf(meet())).toEqual([
      { day: 0, slots: 5, beyond: false },
      { day: 1, slots: 1, beyond: true },
    ]);
  });

  it('lays a day out on a time axis, and leaves out the venues with nothing on them', () => {
    const tt = timetableOf(meet(), 0);
    expect(tt.columns.map((c) => [c.name, c.slots.length, c.min])).toEqual([['Court 1', 2, 50], ['Track', 3, 15]]);
    expect(tt.idle.map((v) => v.name)).toEqual(['Pool']);
    expect(timetableOf(meet(), 0, true).columns.map((c) => c.name)).toEqual(['Court 1', 'Track', 'Pool']);
    // the grid holds the day window, and the five-minute heat is still readable
    expect(tt).toMatchObject({ fromMin: 540, toMin: 960 });
    expect(tt.hours).toEqual([540, 600, 660, 720, 780, 840, 900, 960]);
    expect(tt.pxPerMin).toBe(5);
    expect(Math.round(tt.pxPerMin * 5)).toBeGreaterThanOrEqual(25);
  });

  it('stretches the grid past the bell when a slot runs over, and shrinks the scale for long slots', () => {
    const late = meet({ events: [ev({ matches: [m({ id: 'm1', atMin: 930 })] })] }); // 25 min from 15:30, day ends 16:00
    expect(timetableOf(late, 0)).toMatchObject({ fromMin: 540, toMin: 960 });
    const over = meet({ events: [ev({ matches: [m({ id: 'm1', atMin: 950 })] })] }); // runs to 16:15
    expect(timetableOf(over, 0).toMin).toBe(975);
    expect(timetableOf(over, 0).pxPerMin).toBeCloseTo(1.1, 5); // 25-minute slots need no zoom
  });
});
