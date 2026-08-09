import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { getLibraryTenantPrisma } from '@library/db';
import { loadLibraryEnv } from '../config/env';
import { DB_PROBE, HealthController, REDIS_PROBE, type Probe } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: DB_PROBE,
      useFactory: (): Probe => async () => { await getLibraryTenantPrisma().$queryRawUnsafe('SELECT 1'); },
    },
    {
      provide: REDIS_PROBE,
      useFactory: (): Probe => {
        // enableOfflineQueue: false is load-bearing here, not cosmetic: with
        // it left on (ioredis's default), a ping issued while the client is
        // reconnecting gets queued and waits for the reconnect loop — which
        // retries forever — to succeed, so /ready can hang for minutes
        // instead of reporting degraded. With it off, ping() rejects
        // immediately ("Stream isn't writeable") whenever the connection
        // isn't currently up.
        const redis = new Redis(loadLibraryEnv().LIBRARY_REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          connectTimeout: 2000,
        });
        return async () => {
          if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
          await redis.ping();
        };
      },
    },
  ],
})
export class HealthModule {}
