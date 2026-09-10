import 'reflect-metadata';

const txMock = {
  sportsSettings: { findUnique: jest.fn(), create: jest.fn() },
  sportsTournament: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  sportsVenue: { createMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  sportsEvent: { groupBy: jest.fn(), create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  sportsEntry: { createMany: jest.fn(), findMany: jest.fn() },
  sportsMatch: { createMany: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  sportsHeat: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  student: { findMany: jest.fn() },
  school: { findUnique: jest.fn() },
  notification: { createMany: jest.fn() },
  notificationOutbox: { createMany: jest.fn() },
  house: { findMany: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { SportsSettingsService } from './sports-settings.service';
import { SportsTournamentsService, dayLabel } from './sports-tournaments.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const T = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const E = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const V1 = 'ffffffff-ffff-ffff-ffff-fffffffffff1';
const V2 = 'ffffffff-ffff-ffff-ffff-fffffffffff2';
const uid = (n: number) => `12345678-1234-1234-1234-${String(n).padStart(12, '0')}`;
const settingsRow = {
  schoolId: SCHOOL, grouping: 'BANDS', bands: [{ id: 'jun', label: 'Junior', stds: [7, 8] }, { id: 'sen', label: 'Senior', stds: [9, 10, 11, 12] }],
  pointsPlacing: [10, 7, 5, 3, 2, 1], pointsMatchWin: 5, pointsClassWin: 3, publishNeedsAdmin: false, createdAt: new Date(), updatedAt: new Date(),
};
const student = (n: number, std: number, section = 'A', over: Record<string, unknown> = {}) => ({
  id: uid(n), firstName: `S${n}`, lastName: 'X', dob: new Date('2012-06-01T00:00:00Z'), gender: 'M', houseId: null,
  classSection: { name: section, grade: { name: `Class ${std}`, order: std } }, ...over,
});
const tournamentRow = (over: Record<string, unknown> = {}) => ({
  id: T, schoolId: SCHOOL, name: 'Annual meet', startsOn: new Date('2026-09-15T00:00:00Z'), endsOn: new Date('2026-09-16T00:00:00Z'), grouping: 'BANDS',
  dayStartMin: 540, dayEndMin: 960, restMin: 15, status: 'DRAFT', published: false, version: 1, createdById: ACTOR, createdAt: new Date(), updatedAt: new Date(), ...over,
});
const svc = () => new SportsTournamentsService(new SportsSettingsService());
const baseDto = () => ({
  name: ' Annual meet ', startsOn: '2026-09-15', endsOn: '2026-09-16', venues: [{ name: 'Court 1' }, { name: 'Court 2' }],
  events: [{ sportKey: 'badminton', groupKey: 'sen', category: 'Boys' as const, structure: 'CLASS' as const, venueIdx: [0, 1], studentIds: [uid(1), uid(2), uid(3), uid(4)] }],
});

beforeEach(() => {
  jest.resetAllMocks();
  txMock.sportsSettings.findUnique.mockResolvedValue(settingsRow);
  txMock.student.findMany.mockResolvedValue([student(1, 9), student(2, 9, 'B'), student(3, 10), student(4, 10)]);
  txMock.sportsTournament.create.mockResolvedValue({ id: T });
  txMock.sportsVenue.createMany.mockResolvedValue({ count: 2 });
  txMock.sportsVenue.findMany.mockResolvedValue([{ id: V1 }, { id: V2 }]);
  txMock.sportsEvent.create.mockResolvedValue({ id: E });
  txMock.sportsEntry.createMany.mockResolvedValue({ count: 4 });
  txMock.sportsMatch.createMany.mockResolvedValue({ count: 0 });
  txMock.sportsHeat.create.mockResolvedValue({ id: 'h' });
  txMock.sportsTournament.update.mockResolvedValue({});
  txMock.house.findMany.mockResolvedValue([]);
});

describe('create — what the wizard may not do', () => {
  it('dates in the wrong order, a two-week meet, duplicate venues, an unknown sport and a venue index off the list are refused before any write', async () => {
    const s = svc();
    await expect(s.create(SCHOOL, ACTOR, { ...baseDto(), endsOn: '2026-09-14' })).rejects.toMatchObject({ response: { code: 'VALIDATION', field: 'endsOn' } });
    await expect(s.create(SCHOOL, ACTOR, { ...baseDto(), endsOn: '2026-10-15' })).rejects.toMatchObject({ response: { field: 'endsOn' } });
    await expect(s.create(SCHOOL, ACTOR, { ...baseDto(), venues: [{ name: 'Court' }, { name: ' court ' }] })).rejects.toMatchObject({ response: { field: 'venues' } });
    await expect(s.create(SCHOOL, ACTOR, { ...baseDto(), events: [{ ...baseDto().events[0], sportKey: 'quidditch' }] })).rejects.toMatchObject({ response: { code: 'UNKNOWN_SPORT' } });
    await expect(s.create(SCHOOL, ACTOR, { ...baseDto(), events: [{ ...baseDto().events[0], venueIdx: [5] }] })).rejects.toMatchObject({ response: { field: 'events.0.venueIdx' } });
    expect(txMock.sportsTournament.create).not.toHaveBeenCalled();
  });

  it('students off the roll, a class without a number, a child outside the band, and a one-player draw are refused', async () => {
    const s = svc();
    txMock.student.findMany.mockResolvedValueOnce([student(1, 9)]);
    await expect(s.create(SCHOOL, ACTOR, baseDto())).rejects.toMatchObject({ response: { message: expect.stringMatching(/3 chosen students are not on the active roll/) } });
    txMock.student.findMany.mockResolvedValueOnce([student(1, 9, 'A', { classSection: { name: 'A', grade: { name: 'Nursery', order: 0 } } }), student(2, 9), student(3, 10), student(4, 10)]);
    await expect(s.create(SCHOOL, ACTOR, baseDto())).rejects.toMatchObject({ response: { message: expect.stringMatching(/S1 X is in "Nursery"/) } });
    txMock.student.findMany.mockResolvedValueOnce([student(1, 7), student(2, 9), student(3, 10), student(4, 10)]);
    await expect(s.create(SCHOOL, ACTOR, baseDto())).rejects.toMatchObject({ response: { message: 'S1 X (class 7) is not in Senior.', field: 'events.0.studentIds' } });
    txMock.student.findMany.mockResolvedValueOnce([student(1, 9)]);
    await expect(s.create(SCHOOL, ACTOR, { ...baseDto(), events: [{ ...baseDto().events[0], studentIds: [uid(1)] }] })).rejects.toMatchObject({ response: { code: 'SPORTS_NEED_TWO' } });
    expect(txMock.sportsTournament.create).not.toHaveBeenCalled();
  });

  it('age grouping needs a date of birth and checks the School Games rule', async () => {
    txMock.sportsSettings.findUnique.mockResolvedValue({ ...settingsRow, grouping: 'AGE' });
    const s = svc();
    const dto = { ...baseDto(), events: [{ ...baseDto().events[0], groupKey: 'u14' }] };
    txMock.student.findMany.mockResolvedValueOnce([student(1, 9, 'A', { dob: null }), student(2, 9), student(3, 10), student(4, 10)]);
    await expect(s.create(SCHOOL, ACTOR, dto)).rejects.toMatchObject({ response: { message: expect.stringMatching(/no date of birth/) } });
    txMock.student.findMany.mockResolvedValueOnce([student(1, 9, 'A', { dob: new Date('2010-01-01T00:00:00Z') }), student(2, 9), student(3, 10), student(4, 10)]);
    await expect(s.create(SCHOOL, ACTOR, dto)).rejects.toMatchObject({ response: { message: 'S1 X is not in Under 14 for 2026.' } });
  });
});

describe('create — the one transaction', () => {
  it('writes the tournament, venues, an event with a class draw per class, entries, and scheduled matches', async () => {
    const r = await svc().create(SCHOOL, ACTOR, baseDto());
    expect(r).toEqual({ id: T, days: 2, daysNeeded: 1, warnings: [] });
    expect(txMock.sportsTournament.create.mock.calls[0][0].data).toMatchObject({ schoolId: SCHOOL, name: 'Annual meet', grouping: 'BANDS', dayStartMin: 540, dayEndMin: 960, createdById: ACTOR });
    expect(txMock.sportsVenue.createMany.mock.calls[0][0].data).toEqual([{ schoolId: SCHOOL, tournamentId: T, name: 'Court 1', order: 0 }, { schoolId: SCHOOL, tournamentId: T, name: 'Court 2', order: 1 }]);
    expect(txMock.sportsEvent.create.mock.calls[0][0].data).toMatchObject({ sportKey: 'badminton', sportName: 'Badminton', kind: 'MATCH', groupKey: 'sen', category: 'Boys', structure: 'CLASS', slotMin: 25, venueIds: [V1, V2], order: 0 });
    expect(txMock.sportsEntry.createMany.mock.calls[0][0].data).toEqual([
      { schoolId: SCHOOL, eventId: E, studentId: uid(1), std: 9, section: 'A' }, { schoolId: SCHOOL, eventId: E, studentId: uid(2), std: 9, section: 'B' },
      { schoolId: SCHOOL, eventId: E, studentId: uid(3), std: 10, section: 'A' }, { schoolId: SCHOOL, eventId: E, studentId: uid(4), std: 10, section: 'A' },
    ]);
    const matches = txMock.sportsMatch.createMany.mock.calls[0][0].data;
    expect(matches.map((m: { groupLabel: string; roundName: string }) => `${m.groupLabel} ${m.roundName}`)).toEqual(['Class 9 Final', 'Class 10 Final']);
    expect(matches.every((m: { venueId: string; atMin: number }) => m.venueId && m.atMin === 540)).toBe(true); // two courts, both finals at 09:00
    expect(txMock.sportsHeat.create).not.toHaveBeenCalled();
  });

  it('a team sport draws sections; a measured event gets heats with lane marks; a custom sport is accepted', async () => {
    txMock.student.findMany.mockResolvedValue([student(1, 9), student(2, 9, 'B'), student(3, 9, 'B'), student(4, 10), student(5, 10), student(6, 10), student(7, 10), student(8, 10), student(9, 10), student(10, 10)]);
    const dto = {
      ...baseDto(), venues: [{ name: 'Field' }, { name: 'Track' }],
      events: [
        { sportKey: 'football', groupKey: 'sen', category: 'Boys' as const, structure: 'DRAW' as const, venueIdx: [0], studentIds: [uid(1), uid(2), uid(3), uid(4)], teamBasis: 'SECTIONS' as const },
        { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys' as const, structure: 'CLASS' as const, venueIdx: [1], studentIds: [uid(4), uid(5), uid(6), uid(7), uid(8), uid(9), uid(10)], lanes: 4 },
        { sportKey: 'custom', customName: 'Tug of war', presetKey: 'points', teamSize: 8, groupKey: 'sen', category: 'Mixed' as const, structure: 'DRAW' as const, venueIdx: [0], studentIds: [uid(1), uid(4)] },
      ],
    };
    await svc().create(SCHOOL, ACTOR, dto);
    const football = txMock.sportsMatch.createMany.mock.calls[0][0].data;
    expect(football.map((m: { roundName: string }) => m.roundName)).toEqual(['Semi-final', 'Semi-final', 'Final']);
    expect(football.filter((m: { bye: boolean }) => m.bye)).toHaveLength(1);
    expect(new Set(football.flatMap((m: { aSide: string | null; bSide: string | null }) => [m.aSide, m.bSide]).filter(Boolean))).toEqual(new Set(['c:9-A', 'c:9-B', 'c:10-A']));
    expect(txMock.sportsEvent.create.mock.calls[0][0].data).toMatchObject({ teamBasis: 'SECTIONS' });
    expect(txMock.sportsEvent.create.mock.calls[1][0].data).toMatchObject({ kind: 'MEASURED', structure: 'HEATS', lanes: 4, slotMin: 5 });
    expect(txMock.sportsHeat.create).toHaveBeenCalledTimes(2); // 7 runners on 4 lanes → heats of 4 + 3
    const heat = txMock.sportsHeat.create.mock.calls[0][0].data;
    expect(heat).toMatchObject({ kind: 'HEAT', idx: 0, venueId: V2 });
    expect(heat.atMin).toBeGreaterThanOrEqual(540); // uid(4) also plays football first, so the diary may push this heat later
    expect(heat.marks.createMany.data).toEqual([1, 2, 3, 4].map((lane, i) => ({ schoolId: SCHOOL, studentId: uid(4 + i), lane })));
    expect(txMock.sportsEvent.create.mock.calls[2][0].data).toMatchObject({ sportKey: 'custom:points:8:tug-of-war', sportName: 'Tug of war', kind: 'MATCH', structure: 'DRAW' });
  });

  it('a team sport with a single-section class defaults to whole classes as the teams; houses need houses', async () => {
    txMock.student.findMany.mockResolvedValue([student(1, 9), student(2, 9, 'B'), student(3, 10), student(4, 11)]);
    const dto = { ...baseDto(), venues: [{ name: 'Field' }], events: [{ sportKey: 'football', groupKey: 'sen', category: 'Boys' as const, structure: 'CLASS' as const, venueIdx: [0], studentIds: [uid(1), uid(2), uid(3), uid(4)] }] };
    await svc().create(SCHOOL, ACTOR, dto);
    expect(txMock.sportsEvent.create.mock.calls[0][0].data).toMatchObject({ teamBasis: 'CLASSES', structure: 'DRAW' });
    const sides = new Set(txMock.sportsMatch.createMany.mock.calls[0][0].data.flatMap((m: { aSide: string | null; bSide: string | null }) => [m.aSide, m.bSide]).filter(Boolean));
    expect(sides).toEqual(new Set(['k:9', 'k:10', 'k:11']));
    await expect(svc().create(SCHOOL, ACTOR, { ...dto, events: [{ ...dto.events[0], teamBasis: 'HOUSES' }] })).rejects.toMatchObject({ response: { code: 'SPORTS_NEED_TWO', field: 'events.0.teamBasis' } });
  });

  it('the diary keeps a child in two events apart: the same students in badminton and table tennis are never on two courts at once', async () => {
    txMock.student.findMany.mockResolvedValue([student(1, 9), student(2, 9), student(3, 9), student(4, 9)]);
    const dto = { ...baseDto(), venues: [{ name: 'Court 1' }, { name: 'Table 1' }], events: [
      { sportKey: 'badminton', groupKey: 'sen', category: 'Boys' as const, structure: 'DRAW' as const, venueIdx: [0], studentIds: [uid(1), uid(2), uid(3), uid(4)] },
      { sportKey: 'table-tennis', groupKey: 'sen', category: 'Boys' as const, structure: 'DRAW' as const, venueIdx: [1], studentIds: [uid(1), uid(2), uid(3), uid(4)] },
    ] };
    await svc().create(SCHOOL, ACTOR, dto);
    const bad = txMock.sportsMatch.createMany.mock.calls[0][0].data as { aSide: string; bSide: string; atMin: number | null }[];
    const tt = txMock.sportsMatch.createMany.mock.calls[1][0].data as { aSide: string; bSide: string; atMin: number | null }[];
    for (const b of bad) for (const t of tt) {
      if (b.atMin == null || t.atMin == null) continue;
      const shared = [b.aSide, b.bSide].some((s) => s && [t.aSide, t.bSide].includes(s));
      if (shared) expect(b.atMin < t.atMin + 20 && t.atMin < b.atMin + 25).toBe(false);
    }
  });

  it('warns when the venues cannot hold the plan inside the days given', async () => {
    txMock.student.findMany.mockResolvedValue([student(1, 9), student(2, 9, 'B'), student(3, 9, 'C'), student(4, 9, 'D')]);
    const dto = {
      ...baseDto(), endsOn: '2026-09-15', dayStartMin: 540, dayEndMin: 600, venues: [{ name: 'Field' }],
      events: [{ sportKey: 'football', groupKey: 'sen', category: 'Boys' as const, structure: 'DRAW' as const, venueIdx: [0], studentIds: [uid(1), uid(2), uid(3), uid(4)] }],
    };
    const r = await svc().create(SCHOOL, ACTOR, dto);
    expect(r.days).toBe(1);
    expect(r.daysNeeded).toBe(3); // three 60-minute matches, one hour a day on one field
    expect(r.warnings[0]).toMatch(/needs 3 days/);
  });
});

describe('get', () => {
  it('404 for another school; otherwise one payload with names for every side and the group label', async () => {
    txMock.sportsTournament.findFirst.mockResolvedValue(null);
    await expect(svc().get(SCHOOL, T)).rejects.toMatchObject({ response: { code: 'TOURNAMENT_NOT_FOUND' } });
    txMock.sportsTournament.findFirst.mockResolvedValue(tournamentRow());
    txMock.sportsVenue.findMany.mockResolvedValue([{ id: V1, name: 'Court 1', order: 0 }]);
    txMock.sportsEvent.findMany.mockResolvedValue([{ id: E, sportKey: 'football', sportName: 'Football', kind: 'MATCH', groupKey: 'sen', category: 'Boys', structure: 'CLASS', teamBasis: 'SECTIONS', slotMin: 60, lanes: 6, venueIds: [V1], order: 0 }]);
    txMock.house.findMany.mockResolvedValue([{ id: 'h1', name: 'Red' }]);
    txMock.sportsEntry.findMany.mockResolvedValue([{ eventId: E, studentId: uid(1), std: 9, section: 'a', student: { firstName: 'Aarav', lastName: 'M', houseId: null } }]);
    txMock.sportsMatch.findMany.mockResolvedValue([]);
    txMock.sportsHeat.findMany.mockResolvedValue([]);
    const d = await svc().get(SCHOOL, T);
    expect(d).toMatchObject({ id: T, startsOn: '2026-09-15', endsOn: '2026-09-16', status: 'DRAFT', venues: [{ id: V1, name: 'Court 1' }] });
    expect(d.sideNames).toEqual({ [`s:${uid(1)}`]: 'Aarav M', 'c:9-A': '9 a', 'k:9': 'Class 9', 'h:h1': 'Red' });
    expect(d.events[0]).toMatchObject({ groupLabel: 'Senior', teamSize: 11, scoring: { type: 'SINGLE', label: 'Goals' }, entries: [{ side: 'c:9-A', std: 9 }] });
  });
});

describe('publish / finish / remove', () => {
  beforeEach(() => {
    txMock.school.findUnique.mockResolvedValue({ name: 'Raffles' });
    txMock.sportsVenue.findMany.mockResolvedValue([{ id: V1, name: 'Court 1' }]);
    txMock.sportsEvent.findMany.mockResolvedValue([{ id: E, sportName: 'Badminton', groupKey: 'sen', category: 'Boys', kind: 'MATCH', sportKey: 'badminton' }]);
    txMock.sportsEntry.findMany.mockResolvedValue([
      { eventId: E, studentId: uid(1), std: 9, section: 'A', student: { userId: 'u1', firstName: 'Aarav' } },
      { eventId: E, studentId: uid(2), std: 9, section: 'A', student: { userId: null, firstName: 'Bela' } },
    ]);
    txMock.sportsMatch.findMany.mockResolvedValue([
      { eventId: E, aSide: `s:${uid(1)}`, bSide: `s:${uid(2)}`, roundName: 'Final', groupLabel: 'Class 9', venueId: V1, atMin: 1440 + 615 },
      { eventId: E, aSide: `s:${uid(1)}`, bSide: null, roundName: 'Semi-final', groupLabel: 'Class 9', venueId: V1, atMin: 600 },
    ]);
    txMock.sportsHeat.findMany.mockResolvedValue([]);
    txMock.notification.createMany.mockResolvedValue({ count: 1 });
    txMock.notificationOutbox.createMany.mockResolvedValue({ count: 1 });
  });

  it('a finished meet cannot be published; publishing can be reserved for the admin', async () => {
    txMock.sportsTournament.findFirst.mockResolvedValue(tournamentRow({ status: 'DONE' }));
    await expect(svc().publish(SCHOOL, T, false)).rejects.toMatchObject({ response: { code: 'TOURNAMENT_STATE' } });
    txMock.sportsTournament.findFirst.mockResolvedValue(tournamentRow());
    txMock.sportsSettings.findUnique.mockResolvedValue({ ...settingsRow, publishNeedsAdmin: true });
    await expect(svc().publish(SCHOOL, T, false)).rejects.toMatchObject({ response: { code: 'SPORTS_PERM' } });
    expect(txMock.sportsTournament.update).not.toHaveBeenCalled();
  });

  it('first publish goes LIVE and tells each entered child with a login their earliest slot; a re-publish tells nobody twice', async () => {
    txMock.sportsTournament.findFirst.mockResolvedValue(tournamentRow());
    const r = await svc().publish(SCHOOL, T, false);
    expect(r).toEqual({ notified: 1 });
    expect(txMock.sportsTournament.update.mock.calls[0][0].data).toEqual({ status: 'LIVE', published: true, version: { increment: 1 } });
    const bell = txMock.notification.createMany.mock.calls[0][0].data[0];
    expect(bell).toMatchObject({ userId: 'u1', kind: 'SPORTS', title: "Annual meet: you're in", linkType: 'sports', linkId: T });
    expect(bell.body).toBe('One event. First: Badminton: Semi-final (Class 9), Tue 15 Sep 10:00 at Court 1.');
    expect(txMock.notificationOutbox.createMany.mock.calls[0][0].data[0]).toMatchObject({ kind: 'SPORTS_NOTICE', targetUserId: 'u1' });
    txMock.sportsTournament.findFirst.mockResolvedValue(tournamentRow({ published: true, status: 'LIVE' }));
    expect(await svc().publish(SCHOOL, T, true)).toEqual({ notified: 0 });
  });

  it('finish needs LIVE; delete needs DRAFT', async () => {
    txMock.sportsTournament.findFirst.mockResolvedValue(tournamentRow());
    await expect(svc().finish(SCHOOL, T)).rejects.toMatchObject({ response: { code: 'TOURNAMENT_STATE' } });
    await svc().remove(SCHOOL, T);
    expect(txMock.sportsTournament.delete).toHaveBeenCalledWith({ where: { id: T } });
    txMock.sportsTournament.findFirst.mockResolvedValue(tournamentRow({ status: 'LIVE' }));
    await expect(svc().remove(SCHOOL, T)).rejects.toMatchObject({ response: { code: 'TOURNAMENT_STATE' } });
    await svc().finish(SCHOOL, T);
    expect(txMock.sportsTournament.update.mock.calls.at(-1)![0].data).toEqual({ status: 'DONE', version: { increment: 1 } });
  });
});

describe('board edits', () => {
  beforeEach(() => txMock.sportsTournament.findFirst.mockResolvedValue(tournamentRow({ status: 'LIVE' })));

  it('rain delay moves only unplayed, scheduled slots from the given minute, in one statement per table', async () => {
    txMock.sportsMatch.updateMany.mockResolvedValue({ count: 4 });
    txMock.sportsHeat.updateMany.mockResolvedValue({ count: 1 });
    expect(await svc().shift(SCHOOL, T, { deltaMin: 45, fromMin: 600 })).toEqual({ matches: 4, heats: 1 });
    expect(txMock.sportsMatch.updateMany.mock.calls[0][0]).toEqual({
      where: { schoolId: SCHOOL, event: { tournamentId: T }, atMin: { not: null, gte: 600 }, winner: null, bye: false }, data: { atMin: { increment: 45 } },
    });
    expect(txMock.sportsHeat.updateMany.mock.calls[0][0].where).toMatchObject({ done: false });
  });

  it('moving a slot checks the venue belongs to the meet and the slot exists', async () => {
    txMock.sportsVenue.findFirst.mockResolvedValue(null);
    await expect(svc().move(SCHOOL, T, 'match', 'm1', { venueId: V2, atMin: 700 })).rejects.toMatchObject({ response: { field: 'venueId' } });
    txMock.sportsMatch.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc().move(SCHOOL, T, 'match', 'm1', { atMin: 700 })).rejects.toMatchObject({ response: { code: 'MATCH_NOT_FOUND' } });
    txMock.sportsHeat.updateMany.mockResolvedValue({ count: 1 });
    await svc().move(SCHOOL, T, 'heat', 'h1', { atMin: 700 });
    expect(txMock.sportsHeat.updateMany).toHaveBeenCalledWith({ where: { id: 'h1', schoolId: SCHOOL, event: { tournamentId: T } }, data: { atMin: 700 } });
  });
});

describe('ensureFinal — the band final builds itself', () => {
  const event = { id: E, tournamentId: T, structure: 'CLASS', kind: 'MATCH', teamBasis: 'SECTIONS', slotMin: 25, venueIds: [V1], sportKey: 'badminton', sportName: 'Badminton' };
  beforeEach(() => {
    txMock.sportsEvent.findFirst.mockResolvedValue(event);
    txMock.sportsEntry.findMany.mockResolvedValue([{ studentId: uid(1), std: 9, section: 'A', student: { houseId: null } }, { studentId: uid(2), std: 9, section: 'A', student: { houseId: null } }, { studentId: uid(3), std: 10, section: 'A', student: { houseId: null } }]);
    txMock.sportsTournament.findUnique.mockResolvedValue(tournamentRow());
    txMock.sportsHeat.findMany.mockResolvedValue([]);
  });

  it('waits while a class is still playing; skips a DRAW event and an event that already has its final', async () => {
    txMock.sportsMatch.findMany.mockResolvedValue([{ stage: 'CLASS', groupLabel: 'Class 9', roundIdx: 0, winner: null }]);
    expect(await svc().ensureFinal(txMock as never, SCHOOL, E)).toBe(false);
    txMock.sportsMatch.findMany.mockResolvedValue([{ stage: 'FINAL', groupLabel: 'Final', roundIdx: 0, winner: null }]);
    expect(await svc().ensureFinal(txMock as never, SCHOOL, E)).toBe(false);
    txMock.sportsEvent.findFirst.mockResolvedValue({ ...event, structure: 'DRAW' });
    expect(await svc().ensureFinal(txMock as never, SCHOOL, E)).toBe(false);
    expect(txMock.sportsMatch.createMany).not.toHaveBeenCalled();
  });

  it('class 9 champion and the class 10 walkover meet in a final placed after the last booked slot on the court', async () => {
    txMock.sportsMatch.findMany
      .mockResolvedValueOnce([{ stage: 'CLASS', groupLabel: 'Class 9', roundIdx: 0, winner: `s:${uid(1)}` }])
      .mockResolvedValueOnce([{ venueId: V1, atMin: 700, event: { slotMin: 25 } }]);
    expect(await svc().ensureFinal(txMock as never, SCHOOL, E)).toBe(true);
    const rows = txMock.sportsMatch.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stage: 'FINAL', groupLabel: 'Final', roundName: 'Final', bye: false, venueId: V1, atMin: 725 });
    expect([rows[0].aSide, rows[0].bSide].sort()).toEqual([`s:${uid(1)}`, `s:${uid(3)}`]);
    expect(txMock.sportsTournament.update).toHaveBeenCalledWith({ where: { id: T }, data: { version: { increment: 1 } } });
  });
});

describe('ensureHeatFinal — the best marks go through', () => {
  beforeEach(() => {
    txMock.sportsEvent.findFirst.mockResolvedValue({ id: E, tournamentId: T, kind: 'MEASURED', lanes: 2, slotMin: 5, venueIds: [V1], sportKey: 'ath-100m', sportName: '100 m sprint' });
    txMock.sportsTournament.findUnique.mockResolvedValue(tournamentRow());
    txMock.sportsMatch.findMany.mockResolvedValue([]);
  });

  it('nothing until every heat is done; one heat needs no final', async () => {
    txMock.sportsHeat.findMany.mockResolvedValue([{ kind: 'HEAT', done: true, marks: [] }, { kind: 'HEAT', done: false, marks: [] }]);
    expect(await svc().ensureHeatFinal(txMock as never, SCHOOL, E)).toBe(false);
    txMock.sportsHeat.findMany.mockResolvedValue([{ kind: 'FINAL', done: true, marks: [] }]);
    expect(await svc().ensureHeatFinal(txMock as never, SCHOOL, E)).toBe(false);
    expect(txMock.sportsHeat.create).not.toHaveBeenCalled();
  });

  it('two heats done → a FINAL heat with the two fastest, scheduled after the heats', async () => {
    txMock.sportsHeat.findMany
      .mockResolvedValueOnce([
        { kind: 'HEAT', done: true, marks: [{ studentId: uid(1), mark: 12.5 }, { studentId: uid(2), mark: 12.1 }] },
        { kind: 'HEAT', done: true, marks: [{ studentId: uid(3), mark: 12.3 }, { studentId: uid(4), mark: null }] },
      ])
      .mockResolvedValueOnce([{ venueId: V1, atMin: 545, event: { slotMin: 5 } }]);
    expect(await svc().ensureHeatFinal(txMock as never, SCHOOL, E)).toBe(true);
    const data = txMock.sportsHeat.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'FINAL', idx: 2, venueId: V1, atMin: 550 });
    expect(data.marks.createMany.data).toEqual([{ schoolId: SCHOOL, studentId: uid(2), lane: 1 }, { schoolId: SCHOOL, studentId: uid(3), lane: 2 }]);
  });
});

describe('dayLabel', () => {
  it('names the day of the meet from the DATE column', () => {
    expect(dayLabel(new Date('2026-09-15T00:00:00Z'), 0)).toBe('Tue 15 Sep');
    expect(dayLabel(new Date('2026-09-15T00:00:00Z'), 1)).toBe('Wed 16 Sep');
  });
});
