/**
 * BullMQ's Redis connection options. Using plain options (not an IORedis
 * instance) avoids cross-package ioredis-version drift in TypeScript.
 */
export interface RedisConnectionOpts {
    host: string;
    port: number;
    password?: string;
    maxRetriesPerRequest: null;
}
export declare function redisConnectionFromUrl(url: string): RedisConnectionOpts;
//# sourceMappingURL=redis-connection.d.ts.map