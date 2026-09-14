import 'reflect-metadata';

const txMock = {
  school: { findUnique: jest.fn() },
  homepageContent: { findUnique: jest.fn() },
  schoolProfile: { findUnique: jest.fn() },
  student: { findMany: jest.fn() },
  mediaAsset: { findMany: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));
jest.mock('@skoolos/config', () => ({ loadEnv: () => ({}) }));

import { PublicBirthdaysService } from './public-birthdays.service';

const features = { getFeatures: jest.fn() };
const svc = () => new PublicBirthdaysService(features as never);

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-09-09T03:30:00Z'); // 09:00 IST, Wednesday 9 September

beforeEach(() => {
  jest.clearAllMocks();
  features.getFeatures.mockResolvedValue(new Set(['MANAGEMENT']));
  txMock.school.findUnique.mockResolvedValue({ name: 'Raffles', timezone: 'Asia/Kolkata' });
  txMock.homepageContent.findUnique.mockResolvedValue({ showBirthdays: true });
  txMock.schoolProfile.findUnique.mockResolvedValue({
    celebrationsConfig: { audience: 'BOTH', consentConfirmed: true, showPhotos: true },
  });
  txMock.student.findMany.mockResolvedValue([
    { id: 's1', firstName: 'Aarav', lastName: 'Mehta', dob: new Date('2016-09-09T00:00:00Z'), photoConsent: true, photoAssetId: 'a1', classSection: { name: 'B', grade: { name: '5' } } },
    { id: 's2', firstName: 'Meera', lastName: 'Iyer', dob: new Date('2019-09-11T00:00:00Z'), photoConsent: false, photoAssetId: 'a2', classSection: { name: 'A', grade: { name: '2' } } },
    { id: 's3', firstName: 'Old', lastName: 'Entry', dob: new Date('2010-09-20T00:00:00Z'), photoConsent: true, photoAssetId: null, classSection: null },
  ]);
  txMock.mediaAsset.findMany.mockResolvedValue([{ id: 'a1', url: 'https://cdn/a1.jpg' }, { id: 'a2', url: 'https://cdn/a2.jpg' }]);
});

describe('PublicBirthdaysService', () => {
  it('returns today and upcoming for the week, never a year, photos only with consent', async () => {
    const r = await svc().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(r.generatedFor).toBe('2026-09-09');
    expect(r.window).toBe('WEEK');
    expect(r.today).toEqual([{ day: 9, month: 9, name: 'Aarav M.', classLabel: '5 B', photoUrl: 'https://cdn/a1.jpg', key: expect.any(String) }]);
    expect(r.upcoming.map((u) => u.name)).toEqual(['Meera I.']);
    expect(r.upcoming[0].photoUrl).toBeNull();
    expect(r.next?.name).toBe('Meera I.');
    expect(JSON.stringify(r)).not.toMatch(/2016|2019|2010|dob|age|s1|s2/);
    expect(r.maxAge).toBe(15 * 3600);
  });

  it('only asks for ACTIVE children who are on the wall and have a date of birth, with the photo lookup scoped to the school', async () => {
    await svc().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(txMock.student.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, status: 'ACTIVE', showOnWebsite: true, dob: { not: null } });
    expect(txMock.mediaAsset.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, id: { in: ['a1'] } });
  });

  it('404s when the switch is off, or when the audience is not allowed', async () => {
    txMock.schoolProfile.findUnique.mockResolvedValue({ celebrationsConfig: { audience: 'FAMILIES' } });
    await expect(svc().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW)).rejects.toThrow('Not found');
    await expect(svc().forAudience(SCHOOL, 'FAMILIES', 'WEEK', NOW)).resolves.toMatchObject({ window: 'WEEK' });
    txMock.homepageContent.findUnique.mockResolvedValue({ showBirthdays: false });
    await expect(svc().forAudience(SCHOOL, 'FAMILIES', 'WEEK', NOW)).rejects.toThrow('Not found');
  });

  it('falls back to the configured window for an unknown one; a caller may narrow the window but never widen it', async () => {
    const r = await svc().forAudience(SCHOOL, 'PUBLIC', 'YEAR', NOW);
    expect(r.window).toBe('WEEK');
    // Configured WEEK: MONTH is refused (stays WEEK), TODAY is allowed.
    expect((await svc().forAudience(SCHOOL, 'PUBLIC', 'MONTH', NOW)).window).toBe('WEEK');
    expect((await svc().forAudience(SCHOOL, 'PUBLIC', 'TODAY', NOW)).upcoming).toEqual([]);
    txMock.schoolProfile.findUnique.mockResolvedValue({ celebrationsConfig: { audience: 'BOTH', consentConfirmed: true, showPhotos: true, window: 'MONTH' } });
    const m = await svc().forAudience(SCHOOL, 'PUBLIC', 'MONTH', NOW);
    expect(m.upcoming.map((u) => u.name)).toEqual(['Meera I.', 'Old E.']);
  });

  it('showPhotos off suppresses even a consented photo, and never asks for the asset', async () => {
    txMock.schoolProfile.findUnique.mockResolvedValue({ celebrationsConfig: { audience: 'BOTH', consentConfirmed: true, showPhotos: false } });
    const r = await svc().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(r.today[0].photoUrl).toBeNull();
    expect(txMock.mediaAsset.findMany).not.toHaveBeenCalled();
  });

  it('a 29 February child is on the wall on 28 February in a non-leap year', async () => {
    txMock.student.findMany.mockResolvedValue([
      { id: 's4', firstName: 'Leap', lastName: 'Day', dob: new Date('2016-02-29T00:00:00Z'), photoConsent: false, photoAssetId: null, classSection: null },
    ]);
    const r = await svc().forAudience(SCHOOL, 'PUBLIC', 'TODAY', new Date('2026-02-28T03:30:00Z'));
    expect(r.today).toEqual([expect.objectContaining({ day: 28, month: 2, name: 'Leap D.' })]);
  });

  it('without the Management plan a STUDENTS source is served as the typed list (D5)', async () => {
    features.getFeatures.mockResolvedValue(new Set(['PUBLIC_SITE']));
    txMock.schoolProfile.findUnique.mockResolvedValue({ celebrationsConfig: { audience: 'BOTH', consentConfirmed: true, source: 'STUDENTS', manual: [{ name: 'Typed', day: 9, month: 9, classLabel: null }] } });
    const r = await svc().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(r.today.map((t) => t.name)).toEqual(['Typed']);
    expect(txMock.student.findMany).not.toHaveBeenCalled();
  });

  it('MANUAL source lists the typed entries and never touches the roster', async () => {
    txMock.schoolProfile.findUnique.mockResolvedValue({
      celebrationsConfig: { source: 'MANUAL', audience: 'BOTH', consentConfirmed: true, manual: [{ name: 'Zoya K', day: 10, month: 9, classLabel: '1A' }] },
    });
    const r = await svc().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(txMock.student.findMany).not.toHaveBeenCalled();
    expect(r.today).toEqual([]);
    expect(r.upcoming[0]).toMatchObject({ name: 'Zoya K', day: 10, month: 9, classLabel: '1A', photoUrl: null });
  });

  it('nobody today → next names the first upcoming', async () => {
    txMock.student.findMany.mockResolvedValue([
      { id: 's2', firstName: 'Meera', lastName: 'Iyer', dob: new Date('2019-09-11T00:00:00Z'), photoConsent: false, photoAssetId: null, classSection: null },
    ]);
    const r = await svc().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(r.today).toEqual([]);
    expect(r.next).toMatchObject({ name: 'Meera I.', day: 11, month: 9 });
  });
});
