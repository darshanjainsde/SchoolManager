import 'reflect-metadata';

const txMock = { sportsSettings: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { Prisma } from '@skoolos/db';
import { SportsSettingsService } from './sports-settings.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const row = (over: Record<string, unknown> = {}) => ({
  schoolId: SCHOOL, grouping: 'BANDS', bands: [{ id: 'jun', label: 'Junior', stds: [7, 8] }], pointsPlacing: [10, 7, 5, 3, 2, 1],
  pointsMatchWin: 5, pointsClassWin: 3, publishNeedsAdmin: false, createdAt: new Date(), updatedAt: new Date(), ...over,
});

beforeEach(() => jest.resetAllMocks());

describe('SportsSettingsService', () => {
  it('creates the row on first read; a losing racer re-reads the winner’s row', async () => {
    txMock.sportsSettings.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    txMock.sportsSettings.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    const v = await new SportsSettingsService().get(SCHOOL);
    expect(v.grouping).toBe('BANDS');
    expect(txMock.sportsSettings.create).toHaveBeenCalledWith({ data: { schoolId: SCHOOL } });
  });

  it('malformed stored bands fall back to the defaults instead of breaking the desk', async () => {
    txMock.sportsSettings.findUnique.mockResolvedValue(row({ bands: 'garbage' }));
    const v = await new SportsSettingsService().get(SCHOOL);
    expect(v.bands.map((b) => b.id)).toEqual(['sub', 'jun', 'sen']);
  });

  it('refuses overlapping bands before touching the database', async () => {
    const svc = new SportsSettingsService();
    await expect(svc.update(SCHOOL, { bands: [{ id: 'a', label: 'A', stds: [7, 8] }, { id: 'b', label: 'B', stds: [8, 9] }] })).rejects.toMatchObject({ response: { code: 'SPORTS_BAD_BANDS', field: 'bands' } });
    expect(txMock.sportsSettings.update).not.toHaveBeenCalled();
  });

  it('writes only the fields sent', async () => {
    txMock.sportsSettings.findUnique.mockResolvedValue(row());
    txMock.sportsSettings.update.mockResolvedValue(row({ grouping: 'AGE', publishNeedsAdmin: true }));
    const v = await new SportsSettingsService().update(SCHOOL, { grouping: 'AGE', publishNeedsAdmin: true, pointsClassWin: 0 });
    expect(txMock.sportsSettings.update.mock.calls[0][0].data).toEqual({ grouping: 'AGE', publishNeedsAdmin: true, pointsClassWin: 0 });
    expect(v).toMatchObject({ grouping: 'AGE', publishNeedsAdmin: true });
  });
});
