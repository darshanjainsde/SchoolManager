import { Controller, Get, Inject } from '@nestjs/common';

export const DB_PROBE = 'DB_PROBE';
export const REDIS_PROBE = 'REDIS_PROBE';

export type Probe = () => Promise<void>;

@Controller()
export class HealthController {
  constructor(
    @Inject(DB_PROBE) private readonly dbProbe: Probe,
    @Inject(REDIS_PROBE) private readonly redisProbe: Probe,
  ) {}

  /** Liveness must never depend on anything external, or a Redis blip restarts the app. */
  @Get('live')
  async live(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' | 'degraded'; db: string; redis: string }> {
    const [db, redis] = await Promise.all([
      this.dbProbe().then(() => 'ok').catch(() => 'error'),
      this.redisProbe().then(() => 'ok').catch(() => 'error'),
    ]);
    return { status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded', db, redis };
  }
}
