import { Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getLibraryTenantPrisma } from '@library/db';
import { loadLibraryEnv } from '../config/env';
import { DB_PROBE, HealthController, REDIS_PROBE, type Probe } from './health.controller';

/**
 * Owns the `/ready` Redis client as a real Nest provider (not a bare closure
 * captured in a factory) specifically so `onModuleDestroy` exists to close
 * it. Without this, `INestApplication.close()` had nothing to call: the
 * client this class wraps is the one dangling handle that kept a
 * `test:e2e` jest process alive indefinitely after every test finished, the
 * moment any e2e suite actually hit `/ready` over real HTTP (found while
 * building the authz matrix suite, task-2). `RedisThrottlerStorage`'s
 * client has the opposite lifetime by design (see its own doc comment) and
 * is deliberately NOT touched here — this is specific to this probe's own
 * client.
 */
@Injectable()
class RedisProbe implements OnModuleDestroy {
  // enableOfflineQueue: false is load-bearing here, not cosmetic: with it
  // left on (ioredis's default), a ping issued while the client is
  // reconnecting gets queued and waits for the reconnect loop — which
  // retries forever — to succeed, so /ready can hang for minutes instead of
  // reporting degraded. With it off, ping() rejects immediately ("Stream
  // isn't writeable") whenever the connection isn't currently up.
  private readonly client = new Redis(loadLibraryEnv().LIBRARY_REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });

  async ping(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') await this.client.connect();
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.client.status !== 'end') await this.client.quit();
    } catch {
      // quit() talks to the server to flush in-flight commands first; if
      // that itself fails (already broken connection), fall back to a hard
      // local teardown so shutdown never hangs on a probe that's already down.
      this.client.disconnect();
    }
  }
}

@Module({
  controllers: [HealthController],
  providers: [
    RedisProbe,
    {
      provide: DB_PROBE,
      useFactory: (): Probe => async () => { await getLibraryTenantPrisma().$queryRawUnsafe('SELECT 1'); },
    },
    {
      provide: REDIS_PROBE,
      useFactory: (probe: RedisProbe): Probe => () => probe.ping(),
      inject: [RedisProbe],
    },
  ],
})
export class HealthModule {}
