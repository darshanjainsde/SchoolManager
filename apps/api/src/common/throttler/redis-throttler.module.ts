import { Module } from '@nestjs/common';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Carries the shared rate-limit counter as a real class provider so Nest owns
 * its lifecycle (onModuleDestroy closes the Redis client — required for test
 * runs to exit cleanly).
 */
@Module({
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class RedisThrottlerModule {}
