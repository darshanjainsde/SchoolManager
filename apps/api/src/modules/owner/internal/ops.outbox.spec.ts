const dbMock = {
  notificationOutbox: { count: jest.fn(), findFirst: jest.fn() },
  notificationDelivery: { count: jest.fn(), findFirst: jest.fn() },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => dbMock }));

import { Prisma } from '@skoolos/db';
import { OpsService, type OutboxHealth } from './ops.service';

const NOW = Date.parse('2026-10-06T10:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);
const read = (): Promise<OutboxHealth> =>
  (new OpsService(null as never) as unknown as { readOutbox(): Promise<OutboxHealth> }).readOutbox();

/**
 * The owner console's outbox panel. Since Tier 1 an outbox row keeps sentAt
 * NULL while its deliveries back off (up to ~14.6 h), so "unsent" is no longer
 * "late": the panel counts only work the drain should be doing NOW.
 */
describe('OpsService outbox panel', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    for (const m of [dbMock.notificationOutbox, dbMock.notificationDelivery]) {
      m.count.mockReset().mockResolvedValue(0);
      m.findFirst.mockReset().mockResolvedValue(null);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('counts unexpanded rows, never a row that is only waiting on its deliveries', async () => {
    await read();
    expect(dbMock.notificationOutbox.count).toHaveBeenCalledWith({ where: { sentAt: null, expandedAt: null, attempts: { lt: 5 } } });
  });

  it('counts a QUEUED delivery only once its nextAttemptAt has come — a back-off is not late', async () => {
    await read();
    expect(dbMock.notificationDelivery.count).toHaveBeenCalledWith({ where: { status: 'QUEUED', nextAttemptAt: { lte: new Date(NOW) } } });
  });

  it('adds both, and ages delivery work from when it fell due, not when it was written', async () => {
    dbMock.notificationOutbox.count.mockResolvedValue(2);
    dbMock.notificationOutbox.findFirst.mockResolvedValue({ createdAt: minutesAgo(3) });
    dbMock.notificationDelivery.count.mockImplementation(({ where }) => Promise.resolve(where.status === 'QUEUED' ? 7 : 4));
    dbMock.notificationDelivery.findFirst.mockResolvedValue({ nextAttemptAt: minutesAgo(9) });
    expect(await read()).toEqual({ pending: 9, oldestMinutes: 9, failed24h: 4 });
  });

  it('reads nothing due as an empty queue', async () => {
    expect(await read()).toEqual({ pending: 0, oldestMinutes: null, failed24h: 0 });
  });

  it('counts deliveries that failed for good in the last 24 h', async () => {
    await read();
    expect(dbMock.notificationDelivery.count).toHaveBeenCalledWith({
      where: { status: 'FAILED', nextAttemptAt: { gte: new Date(NOW - 24 * 3_600_000) } },
    });
  });

  it('deployed before the migration: reads unsent rows the Tier-0 way instead of a 500', async () => {
    const missing = new Prisma.PrismaClientKnownRequestError('The table `public.NotificationDelivery` does not exist', { code: 'P2021', clientVersion: 'x' });
    dbMock.notificationDelivery.count.mockRejectedValue(missing);
    dbMock.notificationOutbox.count.mockImplementation(({ where }) =>
      'expandedAt' in where ? Promise.reject(new Prisma.PrismaClientKnownRequestError('column expandedAt does not exist', { code: 'P2022', clientVersion: 'x' })) : Promise.resolve(3),
    );
    dbMock.notificationOutbox.findFirst.mockImplementation(({ where }) =>
      'expandedAt' in where ? Promise.resolve(null) : Promise.resolve({ createdAt: minutesAgo(20) }),
    );
    expect(await read()).toEqual({ pending: 3, oldestMinutes: 20, failed24h: 0 });
  });

  it('still fails loudly on an error that is not a missing schema', async () => {
    dbMock.notificationDelivery.count.mockRejectedValue(new Error('pooler down'));
    await expect(read()).rejects.toThrow('pooler down');
  });
});
