import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * The app's first feature-flag consumer. `/auth/me` has always returned
 * `features`, and the app has always thrown it away (login parses it and
 * persists only the session core) — until the Library tab, nothing in the
 * app was plan-gated.
 *
 * One fetch per app session, cached at module level and shared by both tab
 * bars. Deliberately NOT persisted to storage: a school's plan can change
 * between launches, and a stale "has library" is worse than a beat of
 * "unknown". While unknown (cold start, offline), gated entries stay HIDDEN
 * rather than flashing at every school that never bought them; a failed
 * fetch leaves the cache empty so the next mount retries.
 */
let cached: string[] | null = null;
let inflight: Promise<string[]> | null = null;

/** Test hook — module caches outlive jest module registries. */
export function resetFeatureCacheForTest(): void {
  cached = null;
  inflight = null;
}

export function useFeatures(): string[] | null {
  const [features, setFeatures] = useState<string[] | null>(cached);

  useEffect(() => {
    if (cached !== null) return;
    let cancelled = false;
    if (!inflight) {
      inflight = api
        .request<{ features?: string[] }>('/auth/me')
        .then((me) => {
          cached = me.features ?? [];
          return cached;
        })
        .finally(() => {
          inflight = null;
        });
    }
    inflight
      .then((f) => {
        if (!cancelled) setFeatures(f);
      })
      // Offline / expired session: stay unknown (gated entries hidden); the
      // next mount tries again. Never surfaces an error — a tab bar cannot.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return features;
}

export function hasFeature(features: string[] | null, key: string): boolean {
  return features !== null && features.includes(key);
}
