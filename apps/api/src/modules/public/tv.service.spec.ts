const txMock = {
  school: { findFirst: jest.fn(), update: jest.fn() },
  schoolProfile: { findFirst: jest.fn() },
  announcement: { findMany: jest.fn() },
  event: { findMany: jest.fn() },
  holiday: { findFirst: jest.fn() },
  mediaAsset: { findMany: jest.fn(), findFirst: jest.fn() },
  $queryRaw: jest.fn(),
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { TvService } from './tv.service';
import type { TenantContextService } from '../tenancy';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEY = 'display-key-123';
const MORNING = new Date('2026-09-02T03:30:00Z'); // 09:00 IST, 2 Sept

function makeSvc(ctx: unknown = { kind: 'tenant', schoolId: SCHOOL, hostname: 'raffles.test', schoolSlug: 'raffles' }) {
  const tenant = { get: jest.fn().mockReturnValue(ctx) } as unknown as TenantContextService;
  return new TvService(tenant);
}

describe('TvService.screen — the key is the whole gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles Public School', status: 'LIVE', tvKey: KEY });
    txMock.schoolProfile.findFirst.mockResolvedValue({
      logoAssetId: null, brandColorPrimary: '#123456', brandColorSecondary: '#654321', festiveTheme: null,
    });
    txMock.announcement.findMany.mockResolvedValue([]);
    txMock.event.findMany.mockResolvedValue([]);
    txMock.holiday.findFirst.mockResolvedValue(null);
    txMock.mediaAsset.findMany.mockResolvedValue([]);
    txMock.$queryRaw.mockResolvedValue([]);
  });

  // Every refusal answers exactly like a school with no TV — whether a school
  // runs a screen is not an anonymous caller's business.
  it.each([
    ['no key at all', undefined, { tvKey: KEY, status: 'LIVE' }],
    ['the wrong key', 'wrong-key-12345', { tvKey: KEY, status: 'LIVE' }],
    ['TV switched off', KEY, { tvKey: null, status: 'LIVE' }],
    ['a school not yet live', KEY, { tvKey: KEY, status: 'SETUP' }],
  ])('404s on %s', async (_label, key, school) => {
    txMock.school.findFirst.mockResolvedValue({ name: 'X', ...school });
    await expect(makeSvc().screen(key as string | undefined, MORNING)).rejects.toMatchObject({ status: 404 });
  });

  it('404s on a platform host — the TV belongs to one school', async () => {
    await expect(makeSvc({ kind: 'platform', hostname: 'owner.x' }).screen(KEY, MORNING)).rejects.toMatchObject({ status: 404 });
  });

  it('composes the loop: school-wide notices only, events split today/ahead, birthdays, colours', async () => {
    txMock.announcement.findMany.mockResolvedValue([
      { title: 'PTM Saturday', body: 'B'.repeat(300), createdAt: new Date('2026-09-01T05:00:00Z') },
    ]);
    txMock.event.findMany.mockResolvedValue([
      { title: 'Vigyan Pradarshani', startAt: new Date('2026-09-02T08:30:00Z'), venue: 'Hall A' }, // today 2pm IST
      { title: 'Sports Day', startAt: new Date('2026-09-12T03:30:00Z'), venue: null }, // ahead
    ]);
    txMock.$queryRaw.mockResolvedValue([
      { firstName: 'Kavya', lastName: 'Meena', className: 'VI-A' },
    ]);
    txMock.mediaAsset.findMany.mockResolvedValue([{ url: 'https://cdn/x1.jpg' }]);

    const screen = await makeSvc().screen(KEY, MORNING);

    // The where clause pins the lobby rule: class notes never reach the TV.
    expect(txMock.announcement.findMany.mock.calls[0]![0].where).toEqual({ classSectionId: null });
    expect(screen.school).toMatchObject({ name: 'Raffles Public School', ps1: '#123456', ps2: '#654321' });
    expect(screen.announcements[0]!.body.length).toBeLessThanOrEqual(220); // marquee, not an essay
    expect(screen.eventsToday).toEqual([{ title: 'Vigyan Pradarshani', time: '2:00 pm', venue: 'Hall A' }]);
    expect(screen.eventsUpcoming).toHaveLength(1);
    expect(screen.eventsUpcoming[0]!.title).toBe('Sports Day');
    expect(screen.birthdays).toEqual([{ name: 'Kavya Meena', className: 'VI-A' }]);
    expect(screen.gallery).toEqual(['https://cdn/x1.jpg']);
  });
});

describe('TvService — the admin switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
  });

  it('rotate mints a fresh key and hands back the ready-to-open URL', async () => {
    txMock.school.update.mockResolvedValue({});
    const out = await makeSvc().rotate(SCHOOL, 'raffles.test.sckools.com');

    const written = txMock.school.update.mock.calls[0]![0].data.tvKey;
    expect(written).toMatch(/^[A-Za-z0-9_-]{20,}$/); // urlsafe, unguessable
    expect(out.enabled).toBe(true);
    expect(out.url).toBe(`https://raffles.test.sckools.com/tv?key=${written}`);
  });

  it('disable nulls the key — every screen showing the old URL goes dark', async () => {
    txMock.school.update.mockResolvedValue({});
    const out = await makeSvc().disable(SCHOOL);
    expect(txMock.school.update.mock.calls[0]![0].data).toEqual({ tvKey: null });
    expect(out).toEqual({ enabled: false, url: null });
  });

  it('status reports without minting anything', async () => {
    txMock.school.findFirst.mockResolvedValue({ tvKey: 'k123' });
    const out = await makeSvc().status(SCHOOL, 'raffles.test');
    expect(out).toEqual({ enabled: true, url: 'https://raffles.test/tv?key=k123' });
    expect(txMock.school.update).not.toHaveBeenCalled();
  });
});
