import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { getPlatformPrisma } from '@skoolos/db';
import Redis from 'ioredis';
import { loadEnv } from '@skoolos/config';

@ApiTags('health')
@Controller()
export class HealthController {
  private readonly redis: Redis;

  constructor() {
    const env = loadEnv();
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

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
      if (this.redis.status !== 'ready' && this.redis.status !== 'connecting') {
        await this.redis.connect().catch(() => undefined);
      }
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'ok' : `unexpected:${pong}`;
    } catch (e) {
      return (e as Error).message;
    }
  }
}
