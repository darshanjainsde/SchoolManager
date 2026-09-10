import { describe, it, expect } from 'vitest';
import { sportByKey, customSport } from '@skoolos/types';
import { basisOf, boundVenues, daysOf, eligible, emptyState, fixBasis, groupOptions, makeVenue, problems, resolved, sideCount, singleSectionClasses, teamCounts, toDto, toggleSport } from './wizard-model';
import type { RosterStudent } from './ui';

const bands = [{ id: 'jun', label: 'Junior', stds: [7, 8] }, { id: 'sen', label: 'Senior', stds: [9, 10, 11] }];
const groups = groupOptions('BANDS', bands);
const kid = (id: string, std: number, section: string, gender: string | null, houseId: string | null = null): RosterStudent => ({ id, name: id, std, section, gender, dob: '2012-06-01', houseId });
const roster = [kid('a', 9, 'A', 'M', 'h1'), kid('b', 9, 'B', 'M', 'h2'), kid('c', 10, 'A', 'M', 'h1'), kid('d', 11, 'A', 'M', null), kid('e', 9, 'A', 'F')];
const badminton = sportByKey('badminton')!;
const football = sportByKey('football')!;
const chess = sportByKey('chess')!;
const base = () => ({ ...emptyState('2026-09-15'), name: 'Meet', defaults: { groupKey: 'sen', categories: ['Boys', 'Girls'] as ('Boys' | 'Girls')[], structure: 'CLASS' as const }, venues: [makeVenue('Court 1'), makeVenue('Badminton court 3'), makeVenue('Field'), makeVenue('Main hall')] });

describe('wizard model', () => {
  it('a venue reads its type from its name', () => {
    expect(makeVenue(' Court 1 ')).toEqual({ name: 'Court 1', type: 'court' });
    expect(makeVenue('Football ground').type).toBe('field');
    expect(makeVenue('Quadrangle').type).toBe('hall');
  });

  it('pressing a sport adds one line per default category with nothing else to fill; pressing again removes them', () => {
    let s = toggleSport(base(), badminton);
    expect(s.events.map((e) => [e.sport.key, e.category])).toEqual([['badminton', 'Boys'], ['badminton', 'Girls']]);
    const r = resolved(s, s.events[0]);
    expect(r).toMatchObject({ group: 'sen', structure: 'CLASS', slotMin: 25, venues: { how: 'named', idx: [1] } }); // the badminton court, and only it
    s = toggleSport(s, badminton);
    expect(s.events).toEqual([]);
    s = toggleSport({ ...base(), defaults: { groupKey: 'sen', categories: ['Girls'], structure: 'CLASS' } }, football);
    expect(s.events.map((e) => e.category)).toEqual(['Girls']);
    expect(resolved(s, s.events[0]).structure).toBe('CLASS');
  });

  it('venues bind by name, by type, by fallback, else none; a hand-picked list wins', () => {
    const s = base();
    expect(boundVenues(s, sportByKey('tennis')!)).toMatchObject({ idx: [0], how: 'type' });
    expect(boundVenues(s, football)).toMatchObject({ idx: [2], how: 'type' });
    expect(boundVenues(s, chess)).toMatchObject({ idx: [3], how: 'fallback', want: 'board' });
    expect(boundVenues(s, sportByKey('swim-50-free')!)).toMatchObject({ idx: [], how: 'none', want: 'pool' });
    const t = toggleSport(s, chess);
    expect(resolved({ ...t, events: [{ ...t.events[0], venueIdx: [0, 2] }] }, { ...t.events[0], venueIdx: [0, 2] }).venues).toMatchObject({ idx: [0, 2], how: 'chosen' });
  });

  it('eligibility by band and category', () => {
    expect(eligible(roster, 'sen', 'Boys', 'BANDS', bands, 2026).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(eligible(roster, 'sen', 'Girls', 'BANDS', bands, 2026).map((s) => s.id)).toEqual(['e']);
    expect(eligible(roster, 'jun', 'Mixed', 'BANDS', bands, 2026)).toEqual([]);
  });

  it('a team has a basis: suggested from the entrants, sides counted under it', () => {
    let s = toggleSport({ ...base(), defaults: { groupKey: 'sen', categories: ['Boys'], structure: 'CLASS' } }, football);
    const ev = { ...s.events[0], studentIds: ['a', 'b', 'c', 'd'] };
    expect(basisOf(ev, roster)).toBe('CLASSES'); // 10 and 11 have one section each
    expect(singleSectionClasses(ev, roster)).toEqual([10, 11]);
    expect(teamCounts(ev, roster)).toEqual({ SECTIONS: 4, CLASSES: 3, HOUSES: 2 }); // d has no house
    expect(sideCount(ev, roster)).toBe(3);
    expect(sideCount({ ...ev, teamBasis: 'SECTIONS' }, roster)).toBe(4);
    expect(fixBasis(ev, roster)).toBeNull(); // classes already gives three
    expect(basisOf({ ...ev, studentIds: ['a', 'b'] }, roster)).toBe('SECTIONS');
    expect(sideCount({ ...toggleSport(base(), badminton).events[0], studentIds: ['a', 'b', 'c'] }, roster)).toBe(3);
  });

  it('problems name the fix: too few teams (with the basis that would work), a missing venue, too few players', () => {
    let s = toggleSport({ ...base(), defaults: { groupKey: 'sen', categories: ['Boys'], structure: 'CLASS' } }, football);
    // only class 10 (one section): no basis gives two teams, so the fix is to tick more children
    s = { ...s, events: [{ ...s.events[0], studentIds: ['c'], teamBasis: 'SECTIONS' }] };
    expect(problems(s, roster, groups)).toEqual(['Football Boys: only 1 team under sections. Tick children from another class or section, or put them in houses first.']);
    // class 9 A and 9 B in one class: sections give two teams, classes only one
    s = { ...s, events: [{ ...s.events[0], studentIds: ['a', 'b'], teamBasis: 'CLASSES' }] };
    expect(problems(s, roster, groups)).toEqual(['Football Boys: only 1 team under classes. Make the teams sections instead.']);
    expect(fixBasis(s.events[0], roster)).toBe('SECTIONS');
    s = { ...s, events: [{ ...s.events[0], teamBasis: 'SECTIONS' }] };
    expect(problems(s, roster, groups)).toEqual([]);
    // nobody ticked yet reads as that, never "only 0 teams"
    expect(problems({ ...s, events: [{ ...s.events[0], studentIds: [] }] }, roster, groups)).toEqual(['Football Boys: nobody entered yet.']);
    let t = toggleSport({ ...base(), venues: [makeVenue('Court 1')] }, chess);
    t = { ...t, events: [{ ...t.events[0], studentIds: ['a', 'b'] }, { ...t.events[1], studentIds: ['e'] }] };
    expect(problems(t, roster, groups)).toEqual(['Chess Boys: no board in the venues — add one, or tick a venue on the line.', 'Chess Girls: no board in the venues — add one, or tick a venue on the line.', 'Chess Girls: needs at least two players (has 1).']);
    expect(problems(emptyState('2026-09-15'), roster, groups)).toEqual(['Give the meet a name.', 'Add at least one venue (a court, a field, the track).', 'Press at least one sport.']);
    expect(daysOf({ startsOn: '2026-09-15', endsOn: '2026-09-16' })).toBe(2);
  });

  it('the API body carries resolved values, the team basis, the rest gap, and a custom sport with its venue', () => {
    const tug = customSport('Tug of war', 'points', 8, 'field')!;
    let s = toggleSport({ ...base(), defaults: { groupKey: 'sen', categories: ['Boys'], structure: 'CLASS' }, restMin: 20 }, badminton);
    s = toggleSport(s, football); s = toggleSport(s, tug);
    s = { ...s, events: s.events.map((e) => ({ ...e, studentIds: ['a', 'b', 'c', 'd'], ...(e.sport.key === 'badminton' ? { slotMin: 30 } : {}) })) };
    const dto = toDto(s, roster);
    expect(dto.restMin).toBe(20);
    expect(dto.events[0]).toEqual({ sportKey: 'badminton', groupKey: 'sen', category: 'Boys', structure: 'CLASS', venueIdx: [1], studentIds: ['a', 'b', 'c', 'd'], slotMin: 30 });
    expect(dto.events[1]).toMatchObject({ sportKey: 'football', teamBasis: 'CLASSES', venueIdx: [2] });
    expect(dto.events[2]).toMatchObject({ sportKey: 'custom', customName: 'Tug of war', presetKey: 'points', teamSize: 8, customVenue: 'field', teamBasis: 'CLASSES', venueIdx: [2] });
  });
});
