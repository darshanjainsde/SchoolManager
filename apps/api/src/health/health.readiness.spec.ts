/**
 * /ready answers anyone — it has no guard, and the 4 Sept 2026 audit
 * confirmed it open on staging and production. So whatever it says has to be
 * safe to say to a stranger.
 *
 * The real methods are exercised here by making their dependencies fail. An
 * earlier draft mocked checkDb/checkRedis themselves and asserted on the
 * mocks, which would have passed with the fix reverted.
 */
const queryRaw = jest.fn();
jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => ({ $queryRaw: queryRaw }),
}));

// ensureConnected opens a real socket otherwise, and the suite hangs.
const connected = jest.fn(async () => true);
jest.mock('../common/redis/redis.client', () => ({
  REDIS_CLIENT: 'REDIS_CLIENT',
  ensureConnected: (...a: unknown[]) => connected(...(a as [])),
  sharedRedis: () => undefined,
}));

import { HealthController } from './health.controller';

const LEAKY = new Error(
  "Can't reach database server at db.abc123xyz.supabase.co:5432 (user: postgres)",
);

function controller(redis: unknown) {
  return new HealthController(redis as never) as unknown as {
    ready: () => Promise<{ status: string; db: string; redis: string }>;
  };
}

describe('readiness output', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports ok when the database answers', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const out = await controller({ status: 'ready', ping: async () => 'PONG' }).ready();
    expect(out.db).toBe('ok');
    expect(out.status).toBe('ok');
  });

  it('reports a database failure as "down", not as the driver’s message', async () => {
    queryRaw.mockRejectedValue(LEAKY);
    const out = await controller({ status: 'ready', ping: async () => 'PONG' }).ready();
    expect(out.db).toBe('down');
    expect(out.status).toBe('degraded');
  });

  it('never emits the host, port or user the driver named', async () => {
    queryRaw.mockRejectedValue(LEAKY);
    const out = await controller({ status: 'ready', ping: async () => 'PONG' }).ready();
    const body = JSON.stringify(out);
    expect(body).not.toContain('supabase.co');
    expect(body).not.toContain('5432');
    expect(body).not.toContain('postgres');
  });

  it('reports a redis failure as "down" too', async () => {
    queryRaw.mockResolvedValue([1]);
    const out = await controller({
      status: 'ready',
      ping: async () => { throw new Error('READONLY You cant write against a replica at 10.0.0.4:6379'); },
    }).ready();
    expect(out.redis).toBe('down');
    expect(JSON.stringify(out)).not.toContain('10.0.0.4');
  });

  it('says "unavailable" rather than guessing when redis is absent', async () => {
    queryRaw.mockResolvedValue([1]);
    connected.mockResolvedValueOnce(false);
    const out = await controller(undefined).ready();
    expect(out.redis).toBe('unavailable');
  });

  it('only ever emits one of three words', async () => {
    queryRaw.mockRejectedValue(LEAKY);
    const out = await controller(undefined).ready();
    for (const v of [out.db, out.redis]) {
      expect(['ok', 'down', 'unavailable']).toContain(v);
    }
  });
});
