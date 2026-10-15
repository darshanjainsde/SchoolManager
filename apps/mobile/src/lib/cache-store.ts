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

/**
 * "WHAT IS ON SCREEN MAY BE OLD" — a signal every mounted query listens to.
 *
 * The server is the only truth and it is shared by the web and the app, so a
 * change made on the console must reach a phone that is already open. Two
 * moments say so: the app coming back to the foreground (React Navigation
 * fires no focus then), and a push arriving (somebody just changed something
 * about this person). `askAgain` re-runs each mounted query under its own
 * freshness rule; `markAllStale` first ages every answer so they all fetch.
 * Neither blanks the screen: the old answer stays until the new one lands.
 */
const listeners = new Set<() => void>();
export function onAskAgain(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function askAgain(): void {
  for (const l of [...listeners]) l();
}
export function markAllStale(): void {
  for (const e of store.values()) e.at = 0;
  askAgain();
}

/** Forget everything — sign-out, or switching which child is open. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}
