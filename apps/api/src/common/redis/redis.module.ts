import { Global, Module } from '@nestjs/common';
import { REDIS_CLIENT, sharedRedis, type SharedRedis } from './redis.client';

/**
 * Global so any service can inject the one client without importing a module
 * everywhere. See `redis.client.ts` for why a single client matters.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): SharedRedis => sharedRedis(),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
