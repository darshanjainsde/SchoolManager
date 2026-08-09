import Redis from 'ioredis';

jest.mock('ioredis');

import { Test } from '@nestjs/testing';
import { HealthModule } from './health.module';
import { REDIS_PROBE, type Probe } from './health.controller';

const MockedRedis = Redis as unknown as jest.Mock;

/**
 * The REDIS_PROBE factory in health.module.ts is the only thing standing
 * between a Redis outage and an 11-minute hang on /ready (see
 * task-4-report.md, "Deviation 2"): enableOfflineQueue: false makes ping()
 * reject immediately instead of queuing behind ioredis's infinite reconnect
 * loop, and connectTimeout bounds the initial connect attempt. Neither
 * option is visible to health.controller.spec.ts, which injects fake probes
 * and never reaches this factory — so a refactor could silently drop either
 * option and every existing test would stay green. These tests mock the
 * `ioredis` module (no real Redis I/O) and assert on the real factory inside
 * HealthModule, so a regression here fails loudly.
 */
describe('HealthModule REDIS_PROBE factory', () => {
  beforeEach(() => {
    MockedRedis.mockClear();
  });

  it('constructs the ioredis client with offline-queue disabled and a bounded connect timeout', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    moduleRef.get<Probe>(REDIS_PROBE);

    expect(MockedRedis).toHaveBeenCalledTimes(1);
    const [, options] = MockedRedis.mock.calls[0];
    expect(options).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });
  });

  it('does not connect to redis when the module is wired up — only when the probe closure runs', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    moduleRef.get<Probe>(REDIS_PROBE);

    const instance = MockedRedis.mock.instances[0] as { connect: jest.Mock; status: string };
    expect(instance.connect).not.toHaveBeenCalled();
  });
});
