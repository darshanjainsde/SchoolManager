import 'reflect-metadata';

const txMock = {
  sportsMatch: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  sportsHeat: { findFirst: jest.fn(), update: jest.fn() },
  sportsMark: { deleteMany: jest.fn(), createMany: jest.fn() },
  student: { findMany: jest.fn() },
  sportsEntry: { findMany: jest.fn() },
  sportsSettings: { findUnique: jest.fn() },
  sportsTournament: { update: jest.fn() },
  notification: { createMany: jest.fn() },
  notificationOutbox: { createMany: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { SportsResultsService } from './sports-results.service';
import { SportsSettingsService } from './sports-settings.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const T = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const E = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const M = '11111111-1111-1111-1111-111111111111';
const NEXT = '22222222-2222-2222-2222-222222222222';
const A = 'aaaa0000-0000-0000-0000-00000000000a';
const B = 'bbbb0000-0000-0000-0000-00000000000b';
const settingsRow = { schoolId: SCHOOL, grouping: 'BANDS', bands: [{ id: 'sen', label: 'Senior', stds: [9, 10] }], pointsPlacing: [10, 7, 5, 3, 2, 1], pointsMatchWin: 5, pointsClassWin: 3, publishNeedsAdmin: false, createdAt: new Date(), updatedAt: new Date() };
const tournaments = { ensureFinal: jest.fn(), ensureHeatFinal: jest.fn() };
const houses = { awardMany: jest.fn() };
const records = { noteAttemptIfRecord: jest.fn() };
const svc = () => new SportsResultsService(tournaments as never, houses as never, new SportsSettingsService(), records as never);

const event = (over: Record<string, unknown> = {}) => ({ id: E, tournamentId: T, sportKey: 'badminton', sportName: 'Badminton', groupKey: 'sen', category: 'Boys', structure: 'CLASS', tournament: { status: 'LIVE', name: 'Meet' }, ...over });
const match = (over: Record<string, unknown> = {}) => ({
  id: M, schoolId: SCHOOL, eventId: E, stage: 'CLASS', groupLabel: 'Class 9', roundIdx: 0, roundName: 'Semi-final', pos: 1, aSide: `s:${A}`, bSide: `s:${B}`,
  scoreA: [], scoreB: [], winner: null, bye: false, walkover: false, venueId: null, atMin: 600, version: 1, savedById: null, savedAt: null, event: event(), ...over,
});
const nextMatch = (over: Record<string, unknown> = {}) => ({ id: NEXT, roundIdx: 1, pos: 0, aSide: 's:zz', bSide: null, winner: null, scoreA: [], scoreB: [], ...over });

beforeEach(() => {
  jest.resetAllMocks();
  txMock.sportsSettings.findUnique.mockResolvedValue(settingsRow);
  txMock.sportsMatch.updateMany.mockResolvedValue({ count: 1 });
  txMock.student.findMany.mockResolvedValue([{ id: A, houseId: 'red', firstName: 'Aarav', lastName: 'M', userId: 'uA' }, { id: B, houseId: 'blue', firstName: 'Bela', lastName: 'K', userId: 'uB' }]);
  txMock.sportsEntry.findMany.mockResolvedValue([
    { studentId: A, std: 9, section: 'A', student: { firstName: 'Aarav', lastName: 'M', userId: 'uA' } },
    { studentId: B, std: 9, section: 'B', student: { firstName: 'Bela', lastName: 'K', userId: 'uB' } },
  ]);
  txMock.notification.createMany.mockResolvedValue({ count: 2 });
  txMock.notificationOutbox.createMany.mockResolvedValue({ count: 2 });
  tournaments.ensureFinal.mockResolvedValue(false);
  tournaments.ensureHeatFinal.mockResolvedValue(false);
  houses.awardMany.mockResolvedValue(0);
  records.noteAttemptIfRecord.mockResolvedValue(false);
});

describe('score — refusals', () => {
  it('unknown match, a draft or finished meet, a bye, an unknown side, a stale version', async () => {
    const s = svc();
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(null);
    await expect(s.score(SCHOOL, ACTOR, M, { scoreA: [], scoreB: [], version: 1 })).rejects.toMatchObject({ response: { code: 'MATCH_NOT_FOUND' } });
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match({ event: event({ tournament: { status: 'DRAFT', name: 'x' } }) }));
    await expect(s.score(SCHOOL, ACTOR, M, { scoreA: [], scoreB: [], version: 1 })).rejects.toMatchObject({ response: { code: 'TOURNAMENT_STATE', message: expect.stringMatching(/Publish/) } });
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match({ bye: true, bSide: null }));
    await expect(s.score(SCHOOL, ACTOR, M, { scoreA: [], scoreB: [], version: 1 })).rejects.toMatchObject({ response: { code: 'MATCH_LOCKED' } });
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match({ bSide: null }));
    await expect(s.score(SCHOOL, ACTOR, M, { scoreA: [], scoreB: [], version: 1 })).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match({ version: 3 }));
    await expect(s.score(SCHOOL, ACTOR, M, { scoreA: [], scoreB: [], version: 1 })).rejects.toMatchObject({ response: { code: 'MATCH_CHANGED' } });
    expect(txMock.sportsMatch.updateMany).not.toHaveBeenCalled();
  });

  it('a lost race on the conditional update is MATCH_CHANGED too; a bad score explains the sport’s rule', async () => {
    txMock.sportsMatch.findFirst.mockResolvedValue(match());
    txMock.sportsMatch.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc().score(SCHOOL, ACTOR, M, { scoreA: [21], scoreB: [15], version: 1 })).rejects.toMatchObject({ response: { code: 'MATCH_CHANGED' } });
    await expect(svc().score(SCHOOL, ACTOR, M, { scoreA: [31], scoreB: [29], version: 1 })).rejects.toMatchObject({ response: { code: 'BAD_SCORE', message: 'Each game goes to 21, win by 2, capped at 30; only the last one listed may be in progress.' } });
    await expect(svc().score(SCHOOL, ACTOR, M, { scoreA: [21, 21, 21], scoreB: [1, 1, 1], version: 1 })).rejects.toMatchObject({ response: { message: expect.stringMatching(/already decided/) } });
  });
});

describe('score — saving', () => {
  it('a game in progress saves without a winner, moves nobody, pays nobody, tells nobody', async () => {
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match()).mockResolvedValueOnce(nextMatch());
    const r = await svc().score(SCHOOL, ACTOR, M, { scoreA: [21, 12], scoreB: [15, 15], version: 1 });
    expect(r).toEqual({ version: 2, winner: null, complete: false, finalBuilt: false });
    expect(txMock.sportsMatch.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: M, version: 1 }, data: { scoreA: [21, 12], scoreB: [15, 15], winner: null, walkover: false, version: { increment: 1 }, savedById: ACTOR } });
    expect(txMock.sportsMatch.update).not.toHaveBeenCalled();
    expect(houses.awardMany).not.toHaveBeenCalled();
    expect(txMock.notification.createMany).not.toHaveBeenCalled();
    expect(txMock.sportsTournament.update).toHaveBeenCalledWith({ where: { id: T }, data: { version: { increment: 1 } } });
  });

  it('a finished match puts the winner in the next slot, pays the match win to their house and tells both players', async () => {
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match()).mockResolvedValueOnce(nextMatch());
    const r = await svc().score(SCHOOL, ACTOR, M, { scoreA: [21, 21], scoreB: [15, 19], version: 1 });
    expect(r).toMatchObject({ winner: `s:${A}`, complete: true });
    expect(txMock.sportsMatch.findFirst.mock.calls[1][0].where).toEqual({ schoolId: SCHOOL, eventId: E, stage: 'CLASS', groupLabel: 'Class 9', roundIdx: 1, pos: 0 });
    expect(txMock.sportsMatch.update).toHaveBeenCalledWith({ where: { id: NEXT }, data: { bSide: `s:${A}` } }); // pos 1 is the b side of the next match
    expect(houses.awardMany.mock.calls[0][2]).toEqual([{ houseId: 'red', points: 5, reason: 'Badminton Class 9 Semi-final: win', eventId: E }]);
    const bells = txMock.notification.createMany.mock.calls[0][0].data;
    expect(bells.map((b: { userId: string }) => b.userId).sort()).toEqual(['uA', 'uB']);
    expect(bells[0]).toMatchObject({ kind: 'SPORTS', title: 'Badminton Class 9: Semi-final', body: 'Aarav M 21-15 21-19 Bela K. Aarav M goes through.', linkType: 'sports', linkId: T });
    expect(txMock.notificationOutbox.createMany.mock.calls[0][0].data[0]).toMatchObject({ kind: 'SPORTS_NOTICE', targetUserId: 'uA' });
  });

  it('changing a decided result is refused once the winner has played on; otherwise the slot moves and the ledger is corrected', async () => {
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match({ winner: `s:${A}`, scoreA: [21, 21], scoreB: [1, 1] })).mockResolvedValueOnce(nextMatch({ bSide: `s:${A}`, scoreA: [21] }));
    await expect(svc().score(SCHOOL, ACTOR, M, { scoreA: [1, 1], scoreB: [21, 21], version: 1 })).rejects.toMatchObject({ response: { code: 'MATCH_LOCKED' } });
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match({ winner: `s:${A}`, scoreA: [21, 21], scoreB: [1, 1] })).mockResolvedValueOnce(nextMatch({ bSide: `s:${A}` }));
    await svc().score(SCHOOL, ACTOR, M, { scoreA: [1, 1], scoreB: [21, 21], version: 1 });
    expect(txMock.sportsMatch.update).toHaveBeenCalledWith({ where: { id: NEXT }, data: { bSide: `s:${B}` } });
    expect(houses.awardMany.mock.calls[0][2]).toEqual([
      { houseId: 'red', points: -5, reason: 'Badminton Class 9 Semi-final: win (correction)', eventId: E },
      { houseId: 'blue', points: 5, reason: 'Badminton Class 9 Semi-final: win', eventId: E },
    ]);
  });

  it('the class final pays the champion and asks the tournament to build the band final', async () => {
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match({ roundName: 'Final', roundIdx: 1, pos: 0 })).mockResolvedValueOnce(null);
    tournaments.ensureFinal.mockResolvedValue(true);
    const r = await svc().score(SCHOOL, ACTOR, M, { scoreA: [21, 21], scoreB: [15, 19], version: 1 });
    expect(r.finalBuilt).toBe(true);
    expect(houses.awardMany.mock.calls[0][2]).toEqual([
      { houseId: 'red', points: 5, reason: 'Badminton Class 9 Final: win', eventId: E }, { houseId: 'red', points: 3, reason: 'Badminton Class 9: champion', eventId: E },
    ]);
    expect(tournaments.ensureFinal).toHaveBeenCalledWith(txMock, SCHOOL, E);
    expect(txMock.notification.createMany.mock.calls[0][0].data[0].body).toMatch(/is class champion/);
  });

  it('the band final pays placings: champion, runner-up and both semi-final losers', async () => {
    const C = 'cccc0000-0000-0000-0000-00000000000c';
    const D = 'dddd0000-0000-0000-0000-00000000000d';
    const final = match({ stage: 'FINAL', groupLabel: 'Final', roundIdx: 1, pos: 0, roundName: 'Final', event: event({ structure: 'DRAW' }) });
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(final).mockResolvedValueOnce(null);
    txMock.sportsMatch.findMany.mockResolvedValue([
      { id: 'sf1', stage: 'FINAL', groupLabel: 'Final', roundIdx: 0, roundName: 'Semi-final', pos: 0, aSide: `s:${A}`, bSide: `s:${C}`, winner: `s:${A}`, bye: false, scoreA: [21], scoreB: [1] },
      { id: 'sf2', stage: 'FINAL', groupLabel: 'Final', roundIdx: 0, roundName: 'Semi-final', pos: 1, aSide: `s:${B}`, bSide: `s:${D}`, winner: `s:${B}`, bye: false, scoreA: [21], scoreB: [1] },
      { id: M, stage: 'FINAL', groupLabel: 'Final', roundIdx: 1, roundName: 'Final', pos: 0, aSide: `s:${A}`, bSide: `s:${B}`, winner: null, bye: false, scoreA: [], scoreB: [] },
    ]);
    txMock.student.findMany.mockResolvedValue([{ id: A, houseId: 'red', userId: 'uA', firstName: 'A', lastName: '' }, { id: B, houseId: 'blue', userId: 'uB', firstName: 'B', lastName: '' }, { id: C, houseId: 'green', userId: null, firstName: 'C', lastName: '' }, { id: D, houseId: 'red', userId: null, firstName: 'D', lastName: '' }]);
    await svc().score(SCHOOL, ACTOR, M, { scoreA: [21, 21], scoreB: [15, 19], version: 1 });
    // the semi losers were paid joint third when their semis were saved; the final pays 1st and 2nd
    expect(houses.awardMany.mock.calls[0][2]).toEqual([
      { houseId: 'red', points: 5, reason: 'Badminton Final Final: win', eventId: E },
      { houseId: 'red', points: 10, reason: 'Badminton Boys: 1st', eventId: E },
      { houseId: 'blue', points: 7, reason: 'Badminton Boys: 2nd', eventId: E },
    ]);
    expect(tournaments.ensureFinal).not.toHaveBeenCalled();
  });

  it('a semi-final in the band stage pays the loser joint third as soon as it is saved', async () => {
    const C = 'cccc0000-0000-0000-0000-00000000000c';
    const semi = match({ id: 'sf1', stage: 'FINAL', groupLabel: 'Final', roundIdx: 0, pos: 0, roundName: 'Semi-final', bSide: `s:${C}`, event: event({ structure: 'DRAW' }) });
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(semi).mockResolvedValueOnce({ id: 'f', roundIdx: 1, pos: 0, aSide: null, bSide: null, winner: null, scoreA: [], scoreB: [] });
    txMock.sportsMatch.findMany.mockResolvedValue([
      { id: 'sf1', stage: 'FINAL', groupLabel: 'Final', roundIdx: 0, roundName: 'Semi-final', pos: 0, aSide: `s:${A}`, bSide: `s:${C}`, winner: null, bye: false, scoreA: [], scoreB: [] },
      { id: 'sf2', stage: 'FINAL', groupLabel: 'Final', roundIdx: 0, roundName: 'Semi-final', pos: 1, aSide: `s:${B}`, bSide: 's:zz', winner: null, bye: false, scoreA: [], scoreB: [] },
      { id: 'f', stage: 'FINAL', groupLabel: 'Final', roundIdx: 1, roundName: 'Final', pos: 0, aSide: null, bSide: null, winner: null, bye: false, scoreA: [], scoreB: [] },
    ]);
    txMock.student.findMany.mockResolvedValue([{ id: A, houseId: 'red', userId: 'uA', firstName: 'A', lastName: '' }, { id: C, houseId: 'green', userId: null, firstName: 'C', lastName: '' }, { id: B, houseId: 'blue', userId: null, firstName: 'B', lastName: '' }]);
    await svc().score(SCHOOL, ACTOR, 'sf1', { scoreA: [21, 21], scoreB: [15, 19], version: 1 });
    expect(houses.awardMany.mock.calls[0][2]).toEqual([
      { houseId: 'red', points: 5, reason: 'Badminton Final Semi-final: win', eventId: E },
      { houseId: 'green', points: 5, reason: 'Badminton Boys: 3rd', eventId: E },
    ]);
    expect(txMock.sportsMatch.update).toHaveBeenCalledWith({ where: { id: 'f' }, data: { aSide: `s:${A}` } });
  });

  it('a walkover names the side that turned up and clears the scoresheet', async () => {
    txMock.sportsMatch.findFirst.mockResolvedValueOnce(match()).mockResolvedValueOnce(nextMatch());
    const r = await svc().score(SCHOOL, ACTOR, M, { scoreA: [9, 9], scoreB: [9, 9], version: 1, walkover: 'B' });
    expect(r).toMatchObject({ winner: `s:${B}`, complete: true });
    expect(txMock.sportsMatch.updateMany.mock.calls[0][0].data).toMatchObject({ scoreA: [], scoreB: [], winner: `s:${B}`, walkover: true });
    expect(txMock.notification.createMany.mock.calls[0][0].data[0].body).toBe('Bela K through on a walkover.');
  });
});

describe('marks', () => {
  const H = '33333333-3333-3333-3333-333333333333';
  const heat = (over: Record<string, unknown> = {}) => ({
    id: H, kind: 'HEAT', idx: 1, done: false, venueId: null, atMin: 540,
    marks: [{ studentId: A, lane: 1, mark: null, rank: null }, { studentId: B, lane: 2, mark: null, rank: null }],
    event: { id: E, tournamentId: T, sportKey: 'ath-100m', sportName: '100 m sprint', groupKey: 'sen', category: 'Girls', lanes: 6, tournament: { status: 'LIVE' } }, ...over,
  });
  beforeEach(() => {
    txMock.sportsMark.deleteMany.mockResolvedValue({ count: 2 });
    txMock.sportsMark.createMany.mockResolvedValue({ count: 2 });
    txMock.sportsHeat.update.mockResolvedValue({});
  });

  it('refuses an unknown heat, a draft meet, a stranger in the lanes and a negative mark', async () => {
    const s = svc();
    txMock.sportsHeat.findFirst.mockResolvedValueOnce(null);
    await expect(s.marks(SCHOOL, ACTOR, H, { marks: [{ studentId: A, mark: 12 }], done: false })).rejects.toMatchObject({ response: { code: 'HEAT_NOT_FOUND' } });
    txMock.sportsHeat.findFirst.mockResolvedValueOnce(heat({ event: { ...heat().event, tournament: { status: 'DRAFT' } } }));
    await expect(s.marks(SCHOOL, ACTOR, H, { marks: [{ studentId: A, mark: 12 }], done: false })).rejects.toMatchObject({ response: { code: 'TOURNAMENT_STATE' } });
    txMock.sportsHeat.findFirst.mockResolvedValue(heat());
    await expect(s.marks(SCHOOL, ACTOR, H, { marks: [{ studentId: 'zz', mark: 12 }], done: false })).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    await expect(s.marks(SCHOOL, ACTOR, H, { marks: [{ studentId: A, mark: -1 }], done: false })).rejects.toMatchObject({ response: { code: 'BAD_SCORE' } });
    expect(txMock.sportsMark.deleteMany).not.toHaveBeenCalled();
  });

  it('a sheet still open keeps lanes, merges the marks typed so far, ranks nobody and queues nothing', async () => {
    txMock.sportsHeat.findFirst.mockResolvedValue(heat({ marks: [{ studentId: A, lane: 1, mark: 13.1, rank: null }, { studentId: B, lane: 2, mark: null, rank: null }] }));
    const r = await svc().marks(SCHOOL, ACTOR, H, { marks: [{ studentId: B, mark: 12.345 }], done: false });
    expect(r).toEqual({ finalBuilt: false, attempts: 0 });
    expect(txMock.sportsMark.createMany.mock.calls[0][0].data).toEqual([
      { schoolId: SCHOOL, heatId: H, studentId: A, lane: 1, mark: 13.1, rank: null }, { schoolId: SCHOOL, heatId: H, studentId: B, lane: 2, mark: 12.35, rank: null },
    ]);
    expect(txMock.sportsHeat.update).toHaveBeenCalledWith({ where: { id: H }, data: { done: false } });
    expect(records.noteAttemptIfRecord).not.toHaveBeenCalled();
    expect(tournaments.ensureHeatFinal).not.toHaveBeenCalled();
    expect(txMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('a heat marked done is ranked fastest first, every mark is checked against the book, the final may be built and each runner hears their time', async () => {
    txMock.sportsHeat.findFirst.mockResolvedValue(heat());
    records.noteAttemptIfRecord.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    tournaments.ensureHeatFinal.mockResolvedValue(true);
    const r = await svc().marks(SCHOOL, ACTOR, H, { marks: [{ studentId: A, mark: 12.5 }, { studentId: B, mark: 12.3 }], done: true });
    expect(r).toEqual({ finalBuilt: true, attempts: 1 });
    expect(txMock.sportsMark.createMany.mock.calls[0][0].data.map((k: { studentId: string; rank: number }) => [k.studentId, k.rank])).toEqual([[A, 2], [B, 1]]);
    expect(records.noteAttemptIfRecord).toHaveBeenCalledTimes(2);
    expect(records.noteAttemptIfRecord.mock.calls[0].slice(3)).toEqual([expect.objectContaining({ sportKey: 'ath-100m', groupKey: 'sen', category: 'Girls' }), A, 12.5, 'MEET']);
    expect(tournaments.ensureHeatFinal).toHaveBeenCalledWith(txMock, SCHOOL, E);
    const bells = txMock.notification.createMany.mock.calls[0][0].data;
    expect(bells).toEqual(expect.arrayContaining([expect.objectContaining({ userId: 'uB', title: '100 m sprint Girls: Heat 2', body: '12.30 s · 1st' }), expect.objectContaining({ userId: 'uA', body: '12.50 s · 2nd' })]));
    expect(houses.awardMany).not.toHaveBeenCalled(); // a heat pays nothing
  });

  it('a final marked done pays placings; saving it again pays only the difference', async () => {
    txMock.sportsHeat.findFirst.mockResolvedValueOnce(heat({ kind: 'FINAL', idx: 3 }));
    await svc().marks(SCHOOL, ACTOR, H, { marks: [{ studentId: A, mark: 12.5 }, { studentId: B, mark: 12.3 }], done: true });
    expect(houses.awardMany.mock.calls[0][2]).toEqual([{ houseId: 'red', points: 7, reason: '100 m sprint Girls: 2nd', eventId: E }, { houseId: 'blue', points: 10, reason: '100 m sprint Girls: 1st', eventId: E }]); // lane order
    expect(txMock.notification.createMany.mock.calls[0][0].data).toEqual(expect.arrayContaining([expect.objectContaining({ userId: 'uB', body: '12.30 s · 1st — champion!' })]));
    expect(tournaments.ensureHeatFinal).not.toHaveBeenCalled();
    // the desk corrects A's time: A is now first
    txMock.sportsHeat.findFirst.mockResolvedValueOnce(heat({ kind: 'FINAL', idx: 3, done: true, marks: [{ studentId: A, lane: 1, mark: 12.5, rank: 2 }, { studentId: B, lane: 2, mark: 12.3, rank: 1 }] }));
    await svc().marks(SCHOOL, ACTOR, H, { marks: [{ studentId: A, mark: 12.1 }], done: true });
    expect(houses.awardMany.mock.calls[1][2]).toEqual(expect.arrayContaining([
      { houseId: 'blue', points: -10, reason: '100 m sprint Girls: 1st (correction)', eventId: E }, { houseId: 'red', points: -7, reason: '100 m sprint Girls: 2nd (correction)', eventId: E },
      { houseId: 'red', points: 10, reason: '100 m sprint Girls: 1st', eventId: E }, { houseId: 'blue', points: 7, reason: '100 m sprint Girls: 2nd', eventId: E },
    ]));
  });
});
