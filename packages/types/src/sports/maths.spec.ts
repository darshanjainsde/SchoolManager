import { sportByKey } from './catalogue';
import {
  ageGroupFor, bandFor, beatsRecord, bracketSize, buildDraw, drawPlacings, findClashes, finalists, fitInDay, formatMark, hhmm,
  judgeScores, nextSlot, parseMark, parseSide, placingPoints, planClassStage, planHeats, planRounds, rankMarks, roundName,
  seedPositions, shiftSlots, shuffle, sideOfSection, sideOfStudent,
} from './maths';

const badminton = sportByKey('badminton')!.scoring;
const tt = sportByKey('table-tennis')!.scoring;
const volley = sportByKey('volleyball')!.scoring;
const football = sportByKey('football')!.scoring;
const sprint = sportByKey('ath-100m')!.scoring;
const jump = sportByKey('ath-long-jump')!.scoring;
if (sprint.type !== 'MARK' || jump.type !== 'MARK') throw new Error('catalogue changed');

describe('side keys', () => {
  it('round-trip a student and a section', () => {
    expect(parseSide(sideOfStudent('u1'))).toEqual({ kind: 'student', studentId: 'u1' });
    expect(parseSide(sideOfSection(9, ' a '))).toEqual({ kind: 'section', std: 9, section: 'A' });
    expect(parseSide('nonsense')).toBeNull();
  });
});

describe('judgeScores — games', () => {
  it('badminton: 21-15 21-19 wins in two; 21-19 19-21 is level and still going', () => {
    expect(judgeScores(badminton, [21, 21], [15, 19])).toEqual({ winner: 'A', complete: true });
    expect(judgeScores(badminton, [21, 19], [19, 21])).toEqual({ winner: null, complete: false });
  });
  it('win by two: 21-20 is not a finished game; 22-20 is; 30-29 ends at the cap', () => {
    expect(judgeScores(badminton, [21], [20])).toEqual({ winner: null, complete: false });
    expect(judgeScores(badminton, [22], [20])).toEqual({ winner: null, complete: false }); // one game of three
    expect(judgeScores(badminton, [22, 21], [20, 8])).toEqual({ winner: 'A', complete: true });
    expect(judgeScores(badminton, [30, 21], [29, 0])).toEqual({ winner: 'A', complete: true });
    expect(judgeScores(badminton, [31], [29])).toMatchObject({ error: 'BAD_SCORE' });
  });
  it('an unfinished game may only be the last one listed; a game after the match is decided is an error', () => {
    expect(judgeScores(badminton, [10, 21], [5, 3])).toMatchObject({ error: 'BAD_SCORE' });
    expect(judgeScores(badminton, [21, 21, 21], [3, 3, 3])).toMatchObject({ error: 'EXTRA_GAME' });
  });
  it('table tennis has no cap: 15-13 is a game; volleyball’s fifth set is to 15', () => {
    expect(judgeScores(tt, [15, 11, 11], [13, 4, 4])).toEqual({ winner: 'A', complete: true });
    expect(judgeScores(volley, [25, 20, 25, 20, 15], [20, 25, 20, 25, 13])).toEqual({ winner: 'A', complete: true });
    expect(judgeScores(volley, [25, 20, 25, 20, 25], [20, 25, 20, 25, 23])).toEqual({ winner: 'A', complete: true }); // 25-23 still a valid fifth set (to 15, win by 2)
  });
  it('rejects negatives, fractions and ragged arrays', () => {
    expect(judgeScores(badminton, [21], [-1])).toMatchObject({ error: 'BAD_SCORE' });
    expect(judgeScores(badminton, [21.5], [1])).toMatchObject({ error: 'BAD_SCORE' });
    expect(judgeScores(badminton, [21, 21], [1])).toMatchObject({ error: 'BAD_SCORE' });
    expect(judgeScores(sprint, [1], [2])).toMatchObject({ error: 'NOT_A_MATCH' });
  });
});

describe('judgeScores — single number', () => {
  it('football: 2-1 wins; 1-1 needs the decider; 1-1 then 4-3 on penalties wins', () => {
    expect(judgeScores(football, [2], [1])).toEqual({ winner: 'A', complete: true });
    expect(judgeScores(football, [1], [1])).toMatchObject({ complete: false, error: 'TIE_DECIDER' });
    expect(judgeScores(football, [1, 4], [1, 3])).toEqual({ winner: 'A', complete: true });
    expect(judgeScores(football, [1, 4], [1, 4])).toMatchObject({ error: 'TIE_DECIDER' });
  });
  it('a decider without a tie, or a third number, is a bad score; an empty sheet is simply not started', () => {
    expect(judgeScores(football, [2, 4], [1, 3])).toMatchObject({ error: 'BAD_SCORE' });
    expect(judgeScores(football, [1, 1, 1], [1, 1, 0])).toMatchObject({ error: 'BAD_SCORE' });
    expect(judgeScores(football, [], [])).toEqual({ winner: null, complete: false });
  });
});

describe('marks', () => {
  it('formats seconds, minutes, metres, kilograms and counts', () => {
    expect(formatMark(sprint, 12.3)).toBe('12.30 s');
    expect(formatMark(sprint, 65.2)).toBe('1:05.20');
    expect(formatMark(jump, 5.4)).toBe('5.40 m');
    expect(formatMark({ type: 'MARK', label: 'Total', unit: 'kg', lowerIsBetter: false, precision: 0 }, 62)).toBe('62 kg');
    expect(formatMark({ type: 'MARK', label: 'Jumps', unit: 'reps', lowerIsBetter: false, precision: 0 }, 112)).toBe('112');
    expect(formatMark(sprint, null)).toBe('—');
  });
  it('parses what the desk types, and rounds to the sport’s precision', () => {
    expect(parseMark(sprint, '12.345')).toBe(12.35);
    expect(parseMark(sprint, '1:05.20')).toBe(65.2);
    expect(parseMark(sprint, '12.3 s')).toBe(12.3);
    expect(parseMark(jump, '5,42')).toBeNull();
    expect(parseMark(sprint, '-1')).toBeNull();
    expect(parseMark(sprint, '')).toBeNull();
    expect(parseMark(sprint, '1:xx')).toBeNull();
  });
  it('ranks fastest first with shared ranks, and no-marks last without a rank', () => {
    const r = rankMarks([{ item: 'a', mark: 12.5 }, { item: 'b', mark: 12.1 }, { item: 'c', mark: null }, { item: 'd', mark: 12.1 }], true);
    expect(r.map((x) => [x.item, x.rank])).toEqual([['b', 1], ['d', 1], ['a', 3], ['c', null]]);
    const far = rankMarks([{ item: 'a', mark: 5.1 }, { item: 'b', mark: 5.4 }], false);
    expect(far.map((x) => x.item)).toEqual(['b', 'a']);
  });
  it('a record is beaten strictly, at the sport’s precision', () => {
    expect(beatsRecord(sprint, 12.29, 12.3)).toBe(true);
    expect(beatsRecord(sprint, 12.3, 12.3)).toBe(false);
    expect(beatsRecord(sprint, 12.304, 12.3)).toBe(false);
    expect(beatsRecord(jump, 5.41, 5.4)).toBe(true);
    expect(beatsRecord(jump, 5.39, 5.4)).toBe(false);
  });
});

describe('knockout draws', () => {
  it('bracket sizes and the standard seeding order', () => {
    expect([2, 3, 4, 5, 8, 9, 16, 17].map(bracketSize)).toEqual([2, 4, 4, 8, 8, 16, 16, 32]);
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('9 players → a 16 draw with 7 byes and exactly one real first-round match; byes are placed into round 2', () => {
    const sides = Array.from({ length: 9 }, (_, i) => `s:p${i + 1}`);
    const { size, rounds } = buildDraw(sides);
    expect(size).toBe(16);
    expect(rounds.map((r) => r.length)).toEqual([8, 4, 2, 1]);
    const real = rounds[0].filter((m) => !m.bye);
    expect(real).toHaveLength(1);
    expect(real[0]).toMatchObject({ a: 's:p8', b: 's:p9' });
    expect(rounds[0].filter((m) => m.bye).every((m) => m.winner)).toBe(true);
    // seed 1 and 2 are in opposite halves and already in round 2
    expect(rounds[1][0].a).toBe('s:p1');
    expect(rounds[1][2].a).toBe('s:p2');
    expect(rounds[1][0].b).toBeNull(); // waits for the real match (8 v 9 feeds slot 0b)
    expect(rounds[1][3].b).toBe('s:p6');
  });
  it('never builds a match with two empty sides, for every field size from 2 to 40', () => {
    for (let n = 2; n <= 40; n++) {
      const { rounds } = buildDraw(Array.from({ length: n }, (_, i) => `s:${i}`));
      expect(rounds[0].some((m) => !m.a && !m.b)).toBe(false);
      expect(rounds[0].filter((m) => m.bye)).toHaveLength(bracketSize(n) - n);
    }
  });
  it('duplicate sides collapse; a single side is refused', () => {
    expect(buildDraw(['s:a', 's:a', 's:b']).size).toBe(2);
    expect(() => buildDraw(['s:a', 's:a'])).toThrow('NEED_TWO_SIDES');
  });
  it('round names and the slot a winner advances into', () => {
    expect([0, 1, 2, 3].map((r) => roundName(r, 4))).toEqual(['Round of 16', 'Quarter-final', 'Semi-final', 'Final']);
    expect(roundName(0, 1)).toBe('Final');
    expect(nextSlot(0, 5)).toEqual({ round: 1, pos: 2, side: 'b' });
    expect(nextSlot(1, 2)).toEqual({ round: 2, pos: 1, side: 'a' });
  });
  it('a seeded shuffle is repeatable and keeps every item', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6], 42);
    expect(shuffle([1, 2, 3, 4, 5, 6], 42)).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shuffle([1, 2, 3, 4, 5, 6], 7)).not.toEqual(a);
  });
  it('placings: champion, runner-up, joint third for the semi losers, joint fifth for the quarter losers; byes place nobody', () => {
    const { rounds } = buildDraw(['s:1', 's:2', 's:3', 's:4', 's:5']); // 8 draw, 3 byes
    const [r1, r2, r3] = rounds;
    const real = r1.find((m) => !m.bye)!;
    real.winner = real.a; // s:4 beats s:5
    const ns = nextSlot(real.round, real.pos);
    r2[ns.pos][ns.side] = real.winner;
    for (const m of r2) m.winner = m.a; // s:1 beats s:4, s:2 beats s:3
    r3[0].a = r2[0].winner; r3[0].b = r2[1].winner; r3[0].winner = r3[0].a;
    const placed = drawPlacings(rounds);
    expect(placed.filter((p) => p.rank === 1)).toHaveLength(1);
    expect(placed.filter((p) => p.rank === 2)).toHaveLength(1);
    expect(placed.filter((p) => p.rank === 3)).toHaveLength(2);
    expect(placed.filter((p) => p.rank === 5)).toHaveLength(1); // only the one real quarter-final produced a loser
    expect(placed.find((p) => p.side === 's:5')?.rank).toBe(5);
  });
});

describe('class stage', () => {
  it('two or more classes → a class round each; a lone entrant is champion by walkover; one class → a plain draw', () => {
    const plan = planClassStage([
      { side: 's:a', std: 9 }, { side: 's:b', std: 9 }, { side: 's:c', std: 10 }, { side: 's:d', std: 11 }, { side: 's:e', std: 11 }, { side: 's:e', std: 11 },
    ]);
    expect(plan.mode).toBe('CLASS');
    expect(plan.classes).toEqual([
      { std: 9, sides: ['s:a', 's:b'], walkover: null },
      { std: 10, sides: ['s:c'], walkover: 's:c' },
      { std: 11, sides: ['s:d', 's:e'], walkover: null },
    ]);
    expect(planClassStage([{ side: 's:a', std: 9 }, { side: 's:b', std: 9 }]).mode).toBe('DRAW');
  });
});

describe('heats', () => {
  it('a field that fits the lanes is the final straight away', () => {
    expect(planHeats(['s:1', 's:2', 's:3'], 6)).toEqual([{ idx: 0, kind: 'FINAL', lanes: [{ lane: 1, side: 's:1' }, { lane: 2, side: 's:2' }, { lane: 3, side: 's:3' }] }]);
  });
  it('13 runners on 6 lanes → three balanced heats of 5, 4, 4', () => {
    const heats = planHeats(Array.from({ length: 13 }, (_, i) => `s:${i}`), 6);
    expect(heats.map((h) => h.lanes.length)).toEqual([5, 4, 4]);
    expect(heats.every((h) => h.kind === 'HEAT')).toBe(true);
    expect(new Set(heats.flatMap((h) => h.lanes.map((l) => l.side))).size).toBe(13);
  });
  it('the final takes the best marks across heats and brings a tie at the cut along', () => {
    const marks = [
      { side: 'a', mark: 12.1 }, { side: 'b', mark: 12.5 }, { side: 'c', mark: 12.3 }, { side: 'd', mark: 12.5 }, { side: 'e', mark: null }, { side: 'f', mark: 13.0 },
    ];
    expect(finalists(marks, 3, true)).toEqual(['a', 'c', 'b', 'd']);
    expect(finalists(marks, 2, true)).toEqual(['a', 'c']);
    expect(finalists([], 6, true)).toEqual([]);
  });
});

describe('day board time', () => {
  const w = { dayStartMin: 540, dayEndMin: 960, days: 2 };
  it('prints hh:mm from an absolute minute and rolls a slot that would overrun the day', () => {
    expect(hhmm(540)).toBe('09:00');
    expect(hhmm(1440 + 615)).toBe('10:15');
    expect(fitInDay(0, 25, w)).toBe(540);
    expect(fitInDay(940, 25, w)).toBe(1440 + 540);
    expect(fitInDay(935, 25, w)).toBe(935);
  });
  it('places rounds on the earliest free venue, and a round never starts before the previous one ends', () => {
    const cursor = new Map<string, number>();
    const slots = planRounds([4, 2, 1], ['c1', 'c2'], 25, cursor, w);
    expect(slots[0].map((s) => [s.venueId, hhmm(s.atMin)])).toEqual([['c1', '09:00'], ['c2', '09:00'], ['c1', '09:25'], ['c2', '09:25']]);
    expect(slots[1].every((s) => s.atMin >= 590)).toBe(true);
    expect(slots[2][0].atMin).toBeGreaterThanOrEqual(615);
    expect(cursor.get('c1')).toBeGreaterThan(600);
  });
  it('a shared cursor lets a second event queue behind the first on the same courts', () => {
    const cursor = new Map<string, number>();
    planRounds([2], ['c1'], 60, cursor, w);
    const next = planRounds([1], ['c1'], 60, cursor, w);
    expect(hhmm(next[0][0].atMin)).toBe('11:00');
    expect(() => planRounds([1], [], 10, cursor, w)).toThrow('NEED_VENUE');
  });
  it('rain delay slides slots and rolls past the end of the day', () => {
    const moved = shiftSlots([{ venueId: 'c1', atMin: 900 }, { venueId: 'c1', atMin: 600 }], 60, 30, w);
    expect(moved.map((s) => hhmm(s.atMin))).toEqual(['09:00', '11:00']);
    expect(moved[0].atMin).toBe(1440 + 540);
  });
});

describe('clashes', () => {
  it('finds a person booked twice at once and a venue holding two matches, ignoring unscheduled bookings', () => {
    const clashes = findClashes([
      { id: 'm1', people: ['u1', 'u2'], venueId: 'c1', atMin: 600, slotMin: 25 },
      { id: 'm2', people: ['u2', 'u3'], venueId: 'c2', atMin: 610, slotMin: 25 },
      { id: 'm3', people: ['u9'], venueId: 'c1', atMin: 620, slotMin: 25 },
      { id: 'm4', people: ['u1'], venueId: 'c1', atMin: 625, slotMin: 25 },
      { id: 'm5', people: ['u1'], venueId: null, atMin: null, slotMin: 25 },
    ]);
    expect(clashes).toEqual(expect.arrayContaining([
      { kind: 'PERSON', who: 'u2', first: 'm1', second: 'm2' },
      { kind: 'VENUE', who: 'c1', first: 'm1', second: 'm3' },
      { kind: 'VENUE', who: 'c1', first: 'm3', second: 'm4' },
    ]));
    expect(clashes.find((c) => c.first === 'm5' || c.second === 'm5')).toBeUndefined();
    expect(clashes.find((c) => c.kind === 'PERSON' && c.who === 'u1')).toBeUndefined(); // m1 ends at 625 exactly when m4 starts
  });
});

describe('points and grouping', () => {
  it('placing points fall off the table to zero', () => {
    const t = [10, 7, 5, 3, 2, 1];
    expect([1, 2, 6, 7, null].map((r) => placingPoints(r, t))).toEqual([10, 7, 1, 0, 0]);
  });
  it('bands by class; age groups by the School Games rule (born on or after 1 Jan of meetYear − N + 1)', () => {
    const bands = [{ id: 'jun', label: 'Junior', stds: [7, 8] }, { id: 'sen', label: 'Senior', stds: [9, 10] }];
    expect(bandFor(bands, 8)?.id).toBe('jun');
    expect(bandFor(bands, 12)).toBeNull();
    expect(ageGroupFor(new Date('2012-01-01'), 2025)?.id).toBe('u14');
    expect(ageGroupFor(new Date('2011-12-31'), 2025)?.id).toBe('u17');
    expect(ageGroupFor(new Date('2009-01-01'), 2025)?.id).toBe('u17');
    expect(ageGroupFor(new Date('2008-12-31'), 2025)?.id).toBe('u19');
    expect(ageGroupFor(new Date('2006-12-31'), 2025)).toBeNull();
  });
});
