import 'reflect-metadata';

const txMock = {
  student: { findFirst: jest.fn() },
  sportsSettings: { findUnique: jest.fn() },
  sportsEntry: { findMany: jest.fn() },
  sportsMatch: { findMany: jest.fn() },
  sportsMark: { findMany: jest.fn() },
  sportsVenue: { findMany: jest.fn() },
  sportsTournament: { findMany: jest.fn() },
  house: { findFirst: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { SportsMeService } from './sports-me.service';
import { SportsSettingsService } from './sports-settings.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ME = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const settingsRow = { schoolId: SCHOOL, grouping: 'BANDS', bands: [{ id: 'sen', label: 'Senior', stds: [9, 10] }], pointsPlacing: [10], pointsMatchWin: 5, pointsClassWin: 3, publishNeedsAdmin: false, createdAt: new Date(), updatedAt: new Date() };
const houses = { list: jest.fn() };
const records = { mine: jest.fn() };
const svc = () => new SportsMeService(new SportsSettingsService(), houses as never, records as never);
const tournament = { id: 't1', name: 'Meet', startsOn: new Date('2026-09-15T00:00:00Z'), endsOn: new Date('2026-09-16T00:00:00Z'), status: 'LIVE', dayStartMin: 540 };

beforeEach(() => {
  jest.resetAllMocks();
  txMock.sportsSettings.findUnique.mockResolvedValue(settingsRow);
  records.mine.mockResolvedValue({ records: [], attempts: [] });
});

describe('SportsMeService', () => {
  it('a login with no student row sees an empty tab, never an error', async () => {
    txMock.student.findFirst.mockResolvedValue(null);
    expect(await svc().forUser(SCHOOL, 'u1', 'STUDENT')).toEqual({ role: 'STUDENT', house: null, tournaments: [], records: { records: [], attempts: [] } });
  });

  it('a student sees only their own matches and lanes in published meets, with names for the sides and their house', async () => {
    txMock.student.findFirst.mockResolvedValue({ id: ME, houseId: 'h1' });
    txMock.sportsEntry.findMany
      .mockResolvedValueOnce([
        { eventId: 'e1', std: 9, section: 'A', event: { id: 'e1', sportKey: 'badminton', sportName: 'Badminton', kind: 'MATCH', groupKey: 'sen', category: 'Girls', structure: 'CLASS', tournamentId: 't1', tournament } },
        { eventId: 'e2', std: 9, section: 'A', event: { id: 'e2', sportKey: 'football', sportName: 'Football', kind: 'MATCH', groupKey: 'sen', category: 'Girls', structure: 'DRAW', teamBasis: 'SECTIONS', tournamentId: 't1', tournament } },
        { eventId: 'e3', std: 9, section: 'A', event: { id: 'e3', sportKey: 'ath-100m', sportName: '100 m sprint', kind: 'MEASURED', groupKey: 'sen', category: 'Girls', structure: 'HEATS', tournamentId: 't1', tournament } },
      ])
      .mockResolvedValueOnce([{ studentId: ME, std: 9, section: 'A', student: { firstName: 'Meera', lastName: 'I' } }, { studentId: 'o1', std: 9, section: 'B', student: { firstName: 'Zoya', lastName: 'R' } }]);
    txMock.sportsMatch.findMany.mockResolvedValue([
      { id: 'm1', eventId: 'e1', stage: 'CLASS', groupLabel: 'Class 9', roundName: 'Final', aSide: `s:${ME}`, bSide: 's:o1', scoreA: [21], scoreB: [15], winner: null, bye: false, walkover: false, venueId: 'v1', atMin: 600 },
      { id: 'm2', eventId: 'e2', stage: 'FINAL', groupLabel: 'Final', roundName: 'Final', aSide: 'c:9-A', bSide: 'c:9-B', scoreA: [], scoreB: [], winner: null, bye: false, walkover: false, venueId: null, atMin: null },
    ]);
    txMock.sportsMark.findMany.mockResolvedValue([{ lane: 3, mark: 13.2, rank: 2, heat: { id: 'h1', eventId: 'e3', kind: 'HEAT', idx: 0, venueId: 'v1', atMin: 700, done: true } }]);
    txMock.sportsVenue.findMany.mockResolvedValue([{ id: 'v1', name: 'Court 1' }]);
    txMock.house.findFirst.mockResolvedValue({ id: 'h1', name: 'Red', color: '#f00' });
    const r = await svc().forUser(SCHOOL, 'u1', 'STUDENT');
    if (r.role !== 'STUDENT') throw new Error('expected the student shape');
    expect(r.house).toEqual({ id: 'h1', name: 'Red', color: '#f00' });
    expect(txMock.sportsEntry.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, studentId: ME, event: { tournament: { published: true } } });
    expect(txMock.sportsMatch.findMany.mock.calls[0][0].where.OR).toEqual([{ aSide: { in: [`s:${ME}`, 'c:9-A', `s:${ME}`] } }, { bSide: { in: [`s:${ME}`, 'c:9-A', `s:${ME}`] } }]);
    const t = r.tournaments[0];
    expect(t.events.map((e) => [e.sportName, e.side, e.groupLabel, e.matches.length, e.heats.length])).toEqual([['Badminton', `s:${ME}`, 'Senior', 1, 0], ['Football', 'c:9-A', 'Senior', 1, 0], ['100 m sprint', `s:${ME}`, 'Senior', 0, 1]]);
    expect(t.events[0].matches[0]).toMatchObject({ roundName: 'Final', venue: 'Court 1', atMin: 600, scoreA: [21] });
    expect(t.events[2].heats[0]).toMatchObject({ lane: 3, mark: 13.2, rank: 2, venue: 'Court 1', done: true });
    expect(t.sideNames).toEqual({ [`s:${ME}`]: 'Meera I', 'c:9-A': '9 A', 's:o1': 'Zoya R', 'c:9-B': '9 B', 'k:9': 'Class 9', 'h:h1': 'Red' });
    expect(records.mine).toHaveBeenCalledWith(SCHOOL, ME);
  });

  it('a teacher sees the published meets and the house table', async () => {
    txMock.sportsTournament.findMany.mockResolvedValue([{ id: 't1', name: 'Meet', startsOn: new Date('2026-09-15T00:00:00Z'), endsOn: new Date('2026-09-16T00:00:00Z'), status: 'LIVE' }]);
    houses.list.mockResolvedValue([{ id: 'h1', name: 'Red', points: 12 }]);
    const r = await svc().forUser(SCHOOL, 'u2', 'TEACHER');
    expect(r).toEqual({ role: 'TEACHER', tournaments: [{ id: 't1', name: 'Meet', startsOn: '2026-09-15', endsOn: '2026-09-16', status: 'LIVE' }], houses: [{ id: 'h1', name: 'Red', points: 12 }] });
    expect(txMock.sportsTournament.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, published: true });
  });
});
