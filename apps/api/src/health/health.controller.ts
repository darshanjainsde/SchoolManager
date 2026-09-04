import { Controller, Get, Inject, Logger, Optional } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { getPlatformPrisma } from '@skoolos/db';
import { REDIS_CLIENT, ensureConnected, sharedRedis, type SharedRedis } from '../common/redis/redis.client';

@ApiTags('health')
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
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

  /**
   * `ok` or `down` — never the driver's message.
   *
   * /ready has no guard and answers anyone (verified open on staging and
   * production). Postgres and ioredis errors routinely embed the internal
   * host, port, database and user, so returning them verbatim handed the
   * shape of the infrastructure to an unauthenticated caller. The detail
   * still goes to the log, where the operator can see it and a stranger
   * cannot.
   */
  private async checkDb(): Promise<'ok' | 'down'> {
    try {
      await getPlatformPrisma().$queryRaw`SELECT 1`;
      return 'ok';
    } catch (e) {
      this.logger.error(`readiness: database check failed: ${(e as Error).message}`);
      return 'down';
    }
  }

  private async checkRedis(): Promise<'ok' | 'down' | 'unavailable'> {
    try {
      if (!(await ensureConnected(this.redis))) return 'unavailable';
      const pong = await this.redis!.ping();
      if (pong === 'PONG') return 'ok';
      this.logger.error(`readiness: unexpected redis PING reply: ${pong}`);
      return 'down';
    } catch (e) {
      this.logger.error(`readiness: redis check failed: ${(e as Error).message}`);
      return 'down';
    }
  }
}
