import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { getPlatformPrisma } from '@skoolos/db';
import { REDIS_CLIENT, ensureConnected, sharedRedis, type SharedRedis } from '../common/redis/redis.client';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: SharedRedis = sharedRedis()) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const db = await this.checkDb();
    const redis = await this.checkRedis();
    const ok = db === 'ok' && redis === 'ok';
    return { status: ok ? 'ok' : 'degraded', db, redis };
  }

  private async checkDb(): Promise<'ok' | string> {
    try {
      await getPlatformPrisma().$queryRaw`SELECT 1`;
      return 'ok';
    } catch (e) {
      return (e as Error).message;
    }
  }

  private async checkRedis(): Promise<'ok' | string> {
    try {
      if (!(await ensureConnected(this.redis))) return 'unavailable';
      const pong = await this.redis!.ping();
      return pong === 'PONG' ? 'ok' : `unexpected:${pong}`;
    } catch (e) {
      return (e as Error).message;
    }
  }
}
