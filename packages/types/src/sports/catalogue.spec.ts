import { SPORTS, SPORT_GROUPS, SCORING_PRESETS, customSport, resolveSport, sportByKey, sportsByGroup, sidesAreSections, isCustomSportKey } from './catalogue';

describe('sports catalogue — every sport is complete and consistent', () => {
  it('keys are unique, kebab-case, and every sport sits in a known group', () => {
    const keys = SPORTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SPORTS) {
      expect(s.key).toMatch(/^[a-z0-9-]+$/);
      expect(SPORT_GROUPS).toContain(s.group);
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.slotMin).toBeGreaterThan(0);
      expect(s.categories.length).toBeGreaterThan(0);
    }
  });

  it('MATCH sports score by games or a single number; MEASURED and JUDGED sports carry a mark with a unit and lanes', () => {
    for (const s of SPORTS) {
      if (s.kind === 'MATCH') {
        expect(['GAMES', 'SINGLE']).toContain(s.scoring.type);
        expect(s.lanes).toBeUndefined();
      } else {
        expect(s.scoring.type).toBe('MARK');
        expect(s.lanes).toBeGreaterThan(0);
        if (s.scoring.type === 'MARK') expect(['s', 'm', 'kg', 'pts', 'reps']).toContain(s.scoring.unit);
      }
    }
  });

  it('games scoring is playable: odd best-of, a target, win-by ≥ 1, and a cap above the target when set', () => {
    for (const s of SPORTS) {
      if (s.scoring.type !== 'GAMES') continue;
      expect(s.scoring.bestOf % 2).toBe(1);
      expect(s.scoring.to).toBeGreaterThan(0);
      expect(s.scoring.winBy).toBeGreaterThanOrEqual(1);
      if (s.scoring.cap) expect(s.scoring.cap).toBeGreaterThan(s.scoring.to);
      if (s.scoring.finalTo) expect(s.scoring.finalTo).toBeLessThan(s.scoring.to);
    }
  });

  it('every sport has a rules book: a summary and, unless custom, at least one section with points — no drafting notes left in', () => {
    for (const s of SPORTS) {
      expect(s.rules.summary.length).toBeGreaterThan(20);
      expect(s.rules.sections.length).toBeGreaterThan(0);
      for (const sec of s.rules.sections) {
        expect(sec.points.length).toBeGreaterThan(0);
        for (const p of sec.points) {
          expect(p).not.toMatch(/\bNo — |\? No\b|TODO|TBD/);
          expect(p.trim().length).toBeGreaterThan(15);
        }
      }
    }
  });

  it('covers the major Olympic programme and the Indian school staples', () => {
    for (const key of ['ath-100m', 'ath-long-jump', 'swim-50-free', 'badminton', 'table-tennis', 'tennis', 'football', 'basketball', 'volleyball', 'hockey', 'cricket', 'kabaddi', 'kho-kho', 'boxing', 'judo', 'taekwondo', 'wrestling', 'archery', 'chess', 'carrom', 'gymnastics', 'weightlifting']) {
      expect(sportByKey(key)?.key).toBe(key);
    }
    expect(SPORTS.filter((s) => s.olympic).length).toBeGreaterThanOrEqual(30);
    expect(SPORTS.length).toBeGreaterThanOrEqual(40);
  });

  it('team sports use sections as sides; individual sports use students', () => {
    expect(sidesAreSections(sportByKey('football')!)).toBe(true);
    expect(sidesAreSections(sportByKey('badminton')!)).toBe(false);
    expect(sportByKey('kabaddi')!.teamSize).toBe(7);
  });

  it('groups come out in catalogue order with no empty group', () => {
    const groups = sportsByGroup();
    expect(groups.map((g) => g.group)).toEqual(SPORT_GROUPS);
    for (const g of groups) expect(g.sports.length).toBeGreaterThan(0);
  });

  it('a custom sport takes a preset, gets a custom: key and a plain rules card; a bad preset or empty name is refused', () => {
    const tug = customSport('Tug of war', 'points', 8);
    expect(tug).toMatchObject({ key: 'custom:points:8:tug-of-war', kind: 'MATCH', teamSize: 8, group: 'Team' });
    expect(tug!.scoring.type).toBe('SINGLE');
    expect(isCustomSportKey(tug!.key)).toBe(true);
    expect(customSport('Sack race', 'time', 4)).toMatchObject({ key: 'custom:time:1:sack-race', kind: 'MEASURED', lanes: 6, teamSize: 1 });
    expect(resolveSport('custom:points:8:tug-of-war', 'Tug of War')).toMatchObject({ name: 'Tug of War', teamSize: 8 });
    expect(resolveSport('custom:points:8:tug-of-war')!.name).toBe('tug of war');
    expect(resolveSport('custom:nope:1:x')).toBeUndefined();
    expect(resolveSport('badminton')!.name).toBe('Badminton');
    expect(customSport('   ', 'time')).toBeNull();
    expect(customSport('X', 'nope')).toBeNull();
    for (const p of SCORING_PRESETS) expect(p.kind === 'MATCH' ? p.scoring.type !== 'MARK' : p.scoring.type === 'MARK').toBe(true);
  });
});
