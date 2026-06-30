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

export function redisConnectionFromUrl(url: string): RedisConnectionOpts {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}
