import 'reflect-metadata';

const txMock = { schoolProfile: { findUnique: jest.fn() } };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { PublicRecordsService, homeKeys } from './public-records.service';
import { DEFAULT_RECORDS_SITE } from '../cms';
import type { BookLine } from '../sports';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const features = { getFeatures: jest.fn() };
const book = { book: jest.fn() };
const svc = () => new PublicRecordsService(features as never, book as never);
const line = (key: string, year: number, setOn: string | null = null): BookLine => ({
  key, sportKey: key.split('|')[0], sportName: 'x', groupKey: 'sen', groupLabel: 'Senior', category: 'Boys', unit: 's', lowerIsBetter: true,
  record: { name: 'A', text: '1', value: 1, year, setOn }, history: [], top: [],
});

beforeEach(() => { jest.resetAllMocks(); features.getFeatures.mockResolvedValue(new Set(['SPORTS'])); book.book.mockResolvedValue([]); });

describe('PublicRecordsService', () => {
  it('404 when the book is off, when consent is missing, or when the school lacks the wing', async () => {
    txMock.schoolProfile.findUnique.mockResolvedValue({ recordsConfig: null });
    await expect(svc().forPublic(SCHOOL)).rejects.toMatchObject({ status: 404 });
    txMock.schoolProfile.findUnique.mockResolvedValue({ recordsConfig: { enabled: true } });
    await expect(svc().forPublic(SCHOOL)).rejects.toMatchObject({ status: 404 });
    txMock.schoolProfile.findUnique.mockResolvedValue({ recordsConfig: { enabled: true, consentConfirmed: true } });
    features.getFeatures.mockResolvedValue(new Set([]));
    await expect(svc().forPublic(SCHOOL)).rejects.toMatchObject({ status: 404 });
    expect(book.book).not.toHaveBeenCalled();
  });

  it('formats names in the chosen format, asks for one entry when the top five is off, and picks the homepage keys', async () => {
    txMock.schoolProfile.findUnique.mockResolvedValue({ recordsConfig: { enabled: true, consentConfirmed: true, nameFormat: 'FIRST', showTopFive: false, groups: ['sen'], homeScope: 'ALL' } });
    book.book.mockResolvedValue([line('ath-100m|sen|Boys', 2023)]);
    const r = await svc().forPublic(SCHOOL);
    const opts = book.book.mock.calls[0][1];
    expect(opts.groups).toEqual(['sen']);
    expect(opts.topN).toBe(1);
    expect(opts.formatName('Rohan Iyer')).toBe('Rohan');
    expect(r).toMatchObject({ nameFormat: 'FIRST', pageLayout: 'CABINET', showTopFive: false, home: ['ath-100m|sen|Boys'] });
  });
});

describe('homeKeys', () => {
  const lines = [line('a|sen|Boys', 2019, '2019-11-02'), { ...line('b|sen|Boys', 2025, '2025-09-15') }, line('c|sen|Boys', 2024), { ...line('d|sen|Boys', 2000), record: null }];
  it('RECENT is newest first up to the count; PINNED keeps the office order and drops lines without a record; ALL lists every record', () => {
    expect(homeKeys({ ...DEFAULT_RECORDS_SITE, homeScope: 'RECENT', homeCount: 4 }, lines)).toEqual(['b|sen|Boys', 'c|sen|Boys', 'a|sen|Boys']);
    expect(homeKeys({ ...DEFAULT_RECORDS_SITE, homeScope: 'RECENT', homeCount: 4 }, [...lines, line('e|sen|Boys', 2026), line('f|sen|Boys', 2026)])).toHaveLength(4);
    expect(homeKeys({ ...DEFAULT_RECORDS_SITE, homeScope: 'PINNED', pinned: ['c|sen|Boys', 'd|sen|Boys', 'zz|sen|Boys', 'a|sen|Boys'] }, lines)).toEqual(['c|sen|Boys', 'a|sen|Boys']);
    expect(homeKeys({ ...DEFAULT_RECORDS_SITE, homeScope: 'ALL' }, lines)).toEqual(['a|sen|Boys', 'b|sen|Boys', 'c|sen|Boys']);
  });
});
