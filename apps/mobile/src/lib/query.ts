import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from './api';

/**
 * THE APP'S ONLY CACHE — forty lines, no dependency.
 *
 * Every screen used to hand-roll `useState` + `useFocusEffect` + a fetch, so
 * each tab focus re-asked the server for everything it had just been told,
 * and the screen blanked to a skeleton while it waited. Home did that eight
 * times over on a corridor connection.
 *
 * The rule here is stale-while-revalidate: the last good answer is shown the
 * instant a screen focuses, and a fresh one is fetched behind it. A skeleton
 * appears only when there is nothing to show yet. Pull-to-refresh forces the
 * fetch; sign-out and a shelf switch drop everything, because a cached page
 * from one child must never be shown under another's name.
 *
 * Deliberately in memory only — the diary is a live record, and a cache that
 * survives a relaunch would need a story for "which child, which day" that
 * SecureStore is the wrong place to tell.
 */

import { clearCache, inflight, invalidate, readCache, store } from './cache-store';

/**
 * How long a cached answer counts as fresh on a plain focus. Tab-switching
 * Home → Fees → Home used to refire every Home request each time (perf audit
 * 2026-09-22, #2); within this window the cached answer is shown as-is.
 * Pull-to-refresh and `reload` always fetch.
 */
export const FRESH_MS = 30_000;

export { clearCache, invalidate, readCache };

/** Fetch `path`, sharing one in-flight request between concurrent callers, and remember the answer. */
export function fetchCached<T>(path: string): Promise<T> {
  const running = inflight.get(path) as Promise<T> | undefined;
  if (running) return running;
  const p = api
    .request<T>(path)
    .then((data) => {
      store.set(path, { data, at: Date.now() });
      return data;
    })
    .finally(() => {
      inflight.delete(path);
    });
  inflight.set(path, p);
  return p;
}

export interface QueryState<T> {
  /** The answer — cached or fresh. Null until the first answer lands. */
  data: T | null;
  /** The last failure. Kept alongside stale data so a screen can show both. */
  error: ApiError | null;
  /** True only while there is NOTHING to show yet — the skeleton state. */
  loading: boolean;
  /** True during a pull-to-refresh. Never blanks `data`. */
  refreshing: boolean;
  /** Pull-to-refresh: force a fetch. */
  refresh: () => void;
  /** Re-run the focus fetch (after a write, say). */
  reload: () => void;
}

/**
 * Read `path` on every focus, stale-while-revalidate. `null` disables the
 * query (a feature the school hasn't turned on, a session not yet loaded).
 */
export function useQuery<T>(path: string | null): QueryState<T> {
  const cached = path ? readCache<T>(path) : undefined;
  const [data, setData] = useState<T | null>(cached ?? null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path && cached === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  const run = useCallback(
    (mode: 'focus' | 'refresh') => {
      if (!path) return;
      if (mode === 'refresh') setRefreshing(true);
      const had = readCache<T>(path);
      if (had !== undefined) setData(had);
      else if (mode === 'focus') setLoading(true);
      if (mode === 'focus') {
        const entry = store.get(path);
        if (entry && Date.now() - entry.at < FRESH_MS) {
          setLoading(false);
          return;
        }
      }
      fetchCached<T>(path)
        .then((fresh) => {
          if (!alive.current) return;
          setData(fresh);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!alive.current) return;
          // A rejection that is not an ApiError never reached safeFetch's
          // status-0 path, so it is not "no signal" — it is something we did
          // not expect, and it reads as a server problem with a Try again.
          setError(e instanceof ApiError ? e : new ApiError(-1, 'Something went wrong.'));
        })
        .finally(() => {
          if (!alive.current) return;
          setLoading(false);
          setRefreshing(false);
        });
    },
    [path],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A path that CHANGES after mount — a sheet that opens, a route param that
  // resolves — is a new question. The focus effect covers mount and re-focus;
  // this covers the change in between, without asking twice on mount.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!path || asked.current === path) return;
    asked.current = path;
    run('focus');
  }, [path, run]);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      setError(null);
      if (path) asked.current = path;
      run('focus');
      return () => {
        alive.current = false;
      };
    }, [run]),
  );

  return {
    data,
    error,
    loading,
    refreshing,
    refresh: () => run('refresh'),
    reload: () => run('focus'),
  };
}

/**
 * RETRY FOR A HAND-ROLLED SCREEN. `useQuery` owns its own reload, but the
 * screens that fetch inside their own focus effect had no way to try again —
 * a signal blip while opening the register meant killing the app (UI audit
 * 2026-09-22, #3). Bump the key, list it in the effect's deps, and the same
 * function serves both the Try-again button and pull-to-refresh.
 */
export function useReload(): [number, () => void] {
  const [key, setKey] = useState(0);
  return [key, useCallback(() => setKey((k) => k + 1), [])];
}
