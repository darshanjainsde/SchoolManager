import 'reflect-metadata';

const txMock = {
  sportsSettings: { findUnique: jest.fn() },
  sportsRecord: { findMany: jest.fn() },
  sportsEvent: { findMany: jest.fn() },
  sportsMark: { findMany: jest.fn() },
  student: { findMany: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { SportsBookService } from './sports-book.service';
import { SportsSettingsService } from './sports-settings.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const settingsRow = { schoolId: SCHOOL, grouping: 'BANDS', bands: [{ id: 'jun', label: 'Junior', stds: [7, 8] }, { id: 'sen', label: 'Senior', stds: [9, 10] }], pointsPlacing: [10], pointsMatchWin: 5, pointsClassWin: 3, publishNeedsAdmin: false, createdAt: new Date(), updatedAt: new Date() };
const svc = () => new SportsBookService(new SportsSettingsService());
const initial = (full: string) => { const p = full.split(' '); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : full; };
const rec = (over: Record<string, unknown>) => ({ id: 'r', schoolId: SCHOOL, sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', value: 11.9, unit: 's', holderName: 'Rohan Iyer', holderStudentId: null, setOn: new Date('2023-11-02T00:00:00Z'), sinceYear: 2023, untilYear: null, status: 'STANDING', source: 'MEET', note: null, verifiedById: null, createdAt: new Date('2023-11-02'), ...over });
const mark = (studentId: string, value: number, year: number, over: Record<string, unknown> = {}) => ({ studentId, mark: value, heat: { event: { sportKey: 'ath-100m', sportName: '100 m sprint', groupKey: 'sen', category: 'Boys', tournament: { startsOn: new Date(`${year}-09-15T00:00:00Z`) }, ...over } } });

beforeEach(() => {
  jest.resetAllMocks();
  txMock.sportsSettings.findUnique.mockResolvedValue(settingsRow);
  txMock.student.findMany.mockResolvedValue([{ id: 's1', firstName: 'Aarav', lastName: 'Mehta' }, { id: 's2', firstName: 'Nikhil', lastName: 'Jain' }, { id: 's3', firstName: 'Kabir', lastName: 'Bhat' }]);
});

describe('SportsBookService.book', () => {
  it('builds a line from the record, its history and every ranked mark: one entry per person, ties shared, names formatted', async () => {
    txMock.sportsRecord.findMany.mockResolvedValue([
      rec({ id: 'old', value: 12.4, holderName: 'A. Menon', sinceYear: 1998, untilYear: 2007, status: 'BROKEN' }),
      rec({ id: 'mid', value: 12.1, holderName: 'Kabir Bhat', holderStudentId: 's3', sinceYear: 2007, untilYear: 2023, status: 'BROKEN' }),
      rec({ id: 'now' }),
    ]);
    txMock.sportsMark.findMany.mockResolvedValue([mark('s1', 12.5, 2025), mark('s1', 12.22, 2026), mark('s2', 12.31, 2025), mark('s3', 12.31, 2024), mark('s2', 12.9, 2024)]);
    const [line] = await svc().book(SCHOOL, { formatName: initial, groups: [], topN: 5 });
    expect(line).toMatchObject({ key: 'ath-100m|sen|Boys', sportName: '100 m sprint', groupLabel: 'Senior', category: 'Boys', unit: 's', lowerIsBetter: true });
    expect(line.record).toEqual({ name: 'Rohan I.', text: '11.90 s', value: 11.9, year: 2023, setOn: '2023-11-02' });
    expect(line.history).toEqual([{ name: 'A. M.', text: '12.40 s', value: 12.4, year: 1998, untilYear: 2007 }, { name: 'Kabir B.', text: '12.10 s', value: 12.1, year: 2007, untilYear: 2023 }]);
    // Kabir: the record (12.10) beats his heat mark (12.31); Nikhil and Aarav from heats; Menon from the old record; the standing holder first.
    expect(line.top.map((t) => [t.rank, t.name, t.text, t.year])).toEqual([[1, 'Rohan I.', '11.90 s', 2023], [2, 'Kabir B.', '12.10 s', 2007], [3, 'Aarav M.', '12.22 s', 2026], [4, 'Nikhil J.', '12.31 s', 2025], [5, 'A. M.', '12.40 s', 1998]]);
    expect(txMock.sportsMark.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, mark: { not: null }, heat: { done: true } });
  });

  it('a line with marks but no record yet has record null; a group filter drops the others; topN caps the list', async () => {
    txMock.sportsRecord.findMany.mockResolvedValue([]);
    txMock.sportsMark.findMany.mockResolvedValue([mark('s1', 5.2, 2026, { sportKey: 'ath-long-jump', sportName: 'Long jump', groupKey: 'jun', category: 'Girls' }), mark('s2', 12.3, 2026), mark('s3', 12.2, 2026)]);
    const lines = await svc().book(SCHOOL, { formatName: (n) => n, groups: ['sen'], topN: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0].record).toBeNull();
    expect(lines[0].top).toEqual([{ rank: 1, name: 'Kabir Bhat', text: '12.20 s', value: 12.2, year: 2026 }]);
  });

  it('a sport with no measured mark (a match sport typed by hand) is skipped; a void record never appears', async () => {
    txMock.sportsRecord.findMany.mockResolvedValue([rec({ sportKey: 'badminton', value: 1 })]);
    txMock.sportsMark.findMany.mockResolvedValue([]);
    expect(await svc().book(SCHOOL, { formatName: (n) => n, groups: [], topN: 5 })).toEqual([]);
    expect(txMock.sportsRecord.findMany.mock.calls[0][0].where.status).toEqual({ in: ['STANDING', 'BROKEN'] });
  });
});

describe('SportsBookService.lineIndex', () => {
  it('lists every line from standing records and published measured events with a label the office reads', async () => {
    txMock.sportsRecord.findMany.mockResolvedValue([{ sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys' }]);
    txMock.sportsEvent.findMany.mockResolvedValue([{ sportKey: 'ath-100m', sportName: '100 m sprint', groupKey: 'sen', category: 'Boys' }, { sportKey: 'ath-long-jump', sportName: 'Long jump', groupKey: 'jun', category: 'Girls' }, { sportKey: 'ath-long-jump', sportName: 'Long jump', groupKey: 'jun', category: 'Girls' }]);
    expect(await svc().lineIndex(SCHOOL)).toEqual([
      { key: 'ath-100m|sen|Boys', label: '100 m sprint · Senior Boys', groupKey: 'sen', hasRecord: true, marks: 1 },
      { key: 'ath-long-jump|jun|Girls', label: 'Long jump · Junior Girls', groupKey: 'jun', hasRecord: false, marks: 2 },
    ]);
    expect(txMock.sportsEvent.findMany.mock.calls[0][0].where).toMatchObject({ kind: { in: ['MEASURED', 'JUDGED'] }, tournament: { published: true } });
  });
});
