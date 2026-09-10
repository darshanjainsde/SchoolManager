import { sportByKey } from '@skoolos/types';
import { buildEventPlan, scheduleHeats, scheduleMatches, seedOf, sidesOf } from './sports-build';

const badminton = sportByKey('badminton')!;
const football = sportByKey('football')!;
const sprint = sportByKey('ath-100m')!;
const yoga = sportByKey('yoga')!;
const W = { dayStartMin: 540, dayEndMin: 960, days: 2 };
const entry = (id: string, std: number, section = 'A') => ({ studentId: id, std, section });

describe('sidesOf', () => {
  it('students for an individual sport, sections (deduplicated) for a team sport', () => {
    expect(sidesOf(badminton, [entry('a', 9), entry('b', 9, 'B')]).map((s) => s.side)).toEqual(['s:a', 's:b']);
    expect(sidesOf(football, [entry('a', 9), entry('b', 9), entry('c', 9, 'B'), entry('d', 10)]).map((s) => s.side)).toEqual(['c:9-A', 'c:9-B', 'c:10-A']);
  });
});

describe('buildEventPlan', () => {
  it('CLASS: a draw per class, a lone entrant walks over, no final yet', () => {
    const plan = buildEventPlan(badminton, 'CLASS', [entry('a', 9), entry('b', 9), entry('c', 9), entry('d', 10), entry('e', 11), entry('f', 11)], 1);
    expect(plan.walkovers).toEqual([{ std: 10, side: 's:d' }]);
    const labels = new Set(plan.matches.map((m) => m.groupLabel));
    expect([...labels]).toEqual(['Class 9', 'Class 11']);
    expect(plan.matches.every((m) => m.stage === 'CLASS')).toBe(true);
    // class 9: 3 players → 4 draw → 2 semis (one bye) + final
    const c9 = plan.matches.filter((m) => m.groupLabel === 'Class 9');
    expect(c9.map((m) => m.roundName)).toEqual(['Semi-final', 'Semi-final', 'Final']);
    expect(c9.filter((m) => m.bye)).toHaveLength(1);
    expect(plan.heats).toEqual([]);
  });
  it('DRAW, or CLASS with one class present, is one draw straight to the final; fewer than two sides is refused', () => {
    const plan = buildEventPlan(badminton, 'CLASS', [entry('a', 9), entry('b', 9), entry('c', 9, 'B')], 1);
    expect(plan.matches.every((m) => m.stage === 'FINAL' && m.groupLabel === 'Final')).toBe(true);
    expect(buildEventPlan(badminton, 'DRAW', [entry('a', 9), entry('b', 12)], 1).matches).toHaveLength(1);
    expect(() => buildEventPlan(badminton, 'DRAW', [entry('a', 9)], 1)).toThrow('NEED_TWO_SIDES');
    expect(() => buildEventPlan(football, 'CLASS', [entry('a', 9), entry('b', 9)], 1)).toThrow('NEED_TWO_SIDES'); // same section twice = one side
  });
  it('the same seed draws the same bracket; a different seed usually differs', () => {
    const es = Array.from({ length: 8 }, (_, i) => entry(`p${i}`, 9));
    const a = buildEventPlan(badminton, 'DRAW', es, 7).matches.map((m) => [m.aSide, m.bSide]);
    expect(buildEventPlan(badminton, 'DRAW', es, 7).matches.map((m) => [m.aSide, m.bSide])).toEqual(a);
    expect(buildEventPlan(badminton, 'DRAW', es, 8).matches.map((m) => [m.aSide, m.bSide])).not.toEqual(a);
    expect(seedOf('abc')).toBe(seedOf('abc'));
    expect(seedOf('abc')).not.toBe(seedOf('abd'));
  });
  it('MEASURED: heats by the sport’s lanes; JUDGED: everyone in one panel round', () => {
    const es = Array.from({ length: 13 }, (_, i) => entry(`p${i}`, 7 + (i % 3)));
    const heats = buildEventPlan(sprint, 'CLASS', es, 1).heats;
    expect(heats.map((h) => [h.kind, h.lanes.length])).toEqual([['HEAT', 5], ['HEAT', 4], ['HEAT', 4]]);
    expect(buildEventPlan(yoga, 'DRAW', es, 1).heats).toEqual([expect.objectContaining({ kind: 'FINAL' })]);
    expect(buildEventPlan(yoga, 'DRAW', es, 1).heats[0].lanes).toHaveLength(13);
  });
});

describe('scheduling', () => {
  it('matches: byes get no slot; rounds follow each other; two classes queue on the same courts', () => {
    const plan = buildEventPlan(badminton, 'CLASS', [entry('a', 9), entry('b', 9), entry('c', 9), entry('d', 11), entry('e', 11)], 1);
    const cursor = new Map<string, number>();
    scheduleMatches(plan.matches, ['c1', 'c2'], 25, cursor, W);
    for (const m of plan.matches) {
      if (m.bye) expect(m.atMin).toBeNull(); else expect(m.atMin).not.toBeNull();
    }
    const c9 = plan.matches.filter((m) => m.groupLabel === 'Class 9' && !m.bye);
    expect(c9.find((m) => m.roundName === 'Final')!.atMin!).toBeGreaterThanOrEqual(c9.find((m) => m.roundName === 'Semi-final')!.atMin! + 25);
    const c11 = plan.matches.filter((m) => m.groupLabel === 'Class 11' && !m.bye);
    expect(c11[0].atMin!).toBeGreaterThanOrEqual(540);
    expect(cursor.get('c1')! + cursor.get('c2')!).toBeGreaterThan(1080);
  });
  it('heats spread over the venues in order', () => {
    const plan = buildEventPlan(sprint, 'DRAW', Array.from({ length: 13 }, (_, i) => entry(`p${i}`, 9)), 1);
    const cursor = new Map<string, number>();
    scheduleHeats(plan.heats, ['track'], 5, cursor, W);
    expect(plan.heats.map((h) => h.atMin)).toEqual([540, 545, 550]);
    expect(cursor.get('track')).toBe(555);
  });
});
