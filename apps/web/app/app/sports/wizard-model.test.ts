import { describe, it, expect } from 'vitest';
import { sportByKey, customSport } from '@skoolos/types';
import { daysOf, eligible, emptyState, groupOf, groupOptions, newEvent, problems, sideCount, toDto } from './wizard-model';
import type { RosterStudent } from './ui';

const bands = [{ id: 'jun', label: 'Junior', stds: [7, 8] }, { id: 'sen', label: 'Senior', stds: [9, 10] }];
const kid = (id: string, std: number, section: string, gender: string | null, dob: string | null = '2012-06-01'): RosterStudent => ({ id, name: id, std, section, gender, dob, houseId: null });
const roster = [kid('a', 9, 'A', 'M'), kid('b', 9, 'B', 'F'), kid('c', 10, 'A', null), kid('d', 7, 'A', 'Male'), kid('e', 9, 'A', 'M', '2009-01-01')];
const badminton = sportByKey('badminton')!;
const football = sportByKey('football')!;

describe('wizard model', () => {
  it('group options follow the school’s grouping', () => {
    expect(groupOptions('BANDS', bands).map((g) => g.label)).toEqual(['Junior', 'Senior']);
    expect(groupOptions('AGE', bands).map((g) => g.id)).toEqual(['u14', 'u17', 'u19']);
  });

  it('a new event takes the first group, the sport’s first category, class rounds for a match sport and every venue', () => {
    const ev = newEvent(badminton, groupOptions('BANDS', bands), 2);
    expect(ev).toMatchObject({ groupKey: 'jun', category: 'Boys', structure: 'CLASS', venueIdx: [0, 1], slotMin: 25, studentIds: [] });
    expect(newEvent(sportByKey('ath-100m')!, [], 1)).toMatchObject({ structure: 'DRAW', lanes: 6, groupKey: '' });
  });

  it('eligibility by band and category; Mixed takes all; an unknown gender is offered to both', () => {
    expect(eligible(roster, { groupKey: 'sen', category: 'Boys' }, 'BANDS', bands, 2026).map((s) => s.id)).toEqual(['a', 'c', 'e']);
    expect(eligible(roster, { groupKey: 'sen', category: 'Girls' }, 'BANDS', bands, 2026).map((s) => s.id)).toEqual(['b', 'c']);
    expect(eligible(roster, { groupKey: 'sen', category: 'Mixed' }, 'BANDS', bands, 2026).map((s) => s.id)).toEqual(['a', 'b', 'c', 'e']);
    expect(eligible(roster, { groupKey: 'jun', category: 'Boys' }, 'BANDS', bands, 2026).map((s) => s.id)).toEqual(['d']);
  });

  it('eligibility by age uses the date of birth against the meet year', () => {
    expect(groupOf(kid('x', 9, 'A', 'M', '2013-01-01'), 'AGE', bands, 2026)).toBe('u14');
    expect(groupOf(kid('x', 9, 'A', 'M', '2009-01-01'), 'AGE', bands, 2026)).toBe('u19');
    expect(groupOf(kid('x', 9, 'A', 'M', null), 'AGE', bands, 2026)).toBeNull();
    // born mid-2012: 14 on 31 Dec 2026, so under-17, not under-14
    expect(eligible(roster, { groupKey: 'u14', category: 'Boys' }, 'AGE', bands, 2026)).toEqual([]);
    expect(eligible(roster, { groupKey: 'u17', category: 'Boys' }, 'AGE', bands, 2026).map((s) => s.id)).toEqual(['a', 'c', 'd']);
  });

  it('side count is players for an individual sport and sections for a team sport', () => {
    const ev = { ...newEvent(badminton, [], 1), studentIds: ['a', 'b', 'c'] };
    expect(sideCount(ev, roster)).toBe(3);
    expect(sideCount({ ...ev, sport: football }, roster)).toBe(3);
    expect(sideCount({ ...ev, sport: football, studentIds: ['a', 'e'] }, roster)).toBe(1);
  });

  it('problems: name, dates, hours, venues, sports, then per event', () => {
    const s = emptyState('2026-09-15');
    expect(problems(s, roster)).toEqual(['Give the meet a name.', 'Add at least one venue (a court, a field, the track).', 'Pick at least one sport.']);
    const ev = { ...newEvent(badminton, groupOptions('BANDS', bands), 0), studentIds: ['a'] };
    const s2 = { ...s, name: 'Meet', endsOn: '2026-09-14', dayEndMin: 570, venues: ['Court'], events: [ev] };
    expect(problems(s2, roster)).toEqual(['The last day cannot be before the first.', 'A day needs at least an hour.', 'Badminton Boys: choose a venue.', 'Badminton Boys: needs at least two players (has 1).']);
    expect(daysOf({ startsOn: '2026-09-15', endsOn: '2026-09-16' })).toBe(2);
    expect(daysOf({ startsOn: 'x', endsOn: '2026-09-16' })).toBe(0);
    const ok = { ...s2, endsOn: '2026-09-16', dayEndMin: 960, events: [{ ...ev, venueIdx: [0], studentIds: ['a', 'b'] }] };
    expect(problems(ok, roster)).toEqual([]);
  });

  it('the API body carries only what differs from the sport’s defaults, and rebuilds a custom sport from its key', () => {
    const tug = customSport('Tug of war', 'points', 8)!;
    const s = { ...emptyState('2026-09-15'), name: ' Meet ', venues: ['Field'], events: [
      { ...newEvent(badminton, groupOptions('BANDS', bands), 1), studentIds: ['a', 'b'], slotMin: 30 },
      { ...newEvent(tug, groupOptions('BANDS', bands), 1), studentIds: ['a', 'b'] },
      { ...newEvent(sportByKey('ath-100m')!, groupOptions('BANDS', bands), 1), studentIds: ['a'], lanes: 4 },
    ] };
    const dto = toDto(s);
    expect(dto.name).toBe('Meet');
    expect(dto.venues).toEqual([{ name: 'Field' }]);
    expect(dto.events[0]).toEqual({ sportKey: 'badminton', groupKey: 'jun', category: 'Boys', structure: 'CLASS', venueIdx: [0], studentIds: ['a', 'b'], slotMin: 30 });
    expect(dto.events[1]).toMatchObject({ sportKey: 'custom', customName: 'Tug of war', presetKey: 'points', teamSize: 8 });
    expect(dto.events[2]).toMatchObject({ sportKey: 'ath-100m', lanes: 4 });
    expect('slotMin' in dto.events[2]).toBe(false);
  });
});
