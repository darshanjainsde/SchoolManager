/**
 * The in-memory store behind lib/query.ts, kept dependency-free so
 * lib/session.ts can drop it on a sign-out or a shelf switch without an
 * import cycle (query → api → session → query).
 */
export interface CacheEntry {
  data: unknown;
  at: number;
}

export const store = new Map<string, CacheEntry>();
export const inflight = new Map<string, Promise<unknown>>();

/** The last good answer for `path`, or undefined. Synchronous. */
export function readCache<T>(path: string): T | undefined {
  return store.get(path)?.data as T | undefined;
}

/** Forget every answer whose path starts with `prefix` (a write to /me/fees invalidates '/me/fees'). */
export function invalidate(prefix: string): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

/** Forget everything — sign-out, or switching which child is open. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}
