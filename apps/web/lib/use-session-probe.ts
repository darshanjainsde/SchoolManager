'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from './api';
import { useAuthStore, takeLegacyRefreshToken, dropLegacyRefreshToken, type Audience } from './auth-store';

interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
  /**
   * Who the session belongs to — features, role, name, staff role.
   *
   * Sent by POST /auth/refresh so the boot does not need a second round trip
   * to GET /auth/me. Optional because the owner console refreshes on a
   * different endpoint that has no equivalent, and because a browser may be
   * talking to an API deployed before the field existed.
   */
  me?: unknown;
}

/**
 * Answers "is this browser signed in?" once per tab.
 *
 * The refresh token is an HttpOnly cookie, so the client cannot inspect it —
 * the only way to know is to ask the API to spend it. One POST /auth/refresh
 * on boot resolves `status` from `unknown` to `authed` or `anon`, and leaves a
 * fresh access token in memory.
 *
 * It also carries the migration: a session created before the cookie existed
 * still has its token in localStorage, so that value is sent once, in the body,
 * and dropped as soon as the API answers with a cookie. Nobody is signed out
 * by the upgrade.
 *
 * The answer also carries the `me` payload, which is seeded into the query
 * cache here. Every console layout used to ask for it separately, so a boot was
 * refresh → /auth/me → the page's own queries, three round trips deep, with
 * nothing on screen until the second came back. Seeding means the layouts'
 * existing `['me']` / `['me', host]` queries find fresh data and never fire.
 * Nothing at those call sites changed: if the field is missing — an older API,
 * or the owner console's own refresh endpoint — they fetch exactly as before.
 *
 * @param ready pass false while the tenant host is still unknown — a school
 *              refresh without the host header cannot resolve its tenant.
 * @param hostKey the tenant host, for the `['me', host]` cache key. Omit on the
 *              platform audience, which has neither a host nor a me payload.
 */
export function useSessionProbe(
  api: ApiClient,
  audience: Audience,
  ready = true,
  hostKey?: string,
): void {
  const status = useAuthStore((s) => s.status);
  const setStatus = useAuthStore((s) => s.setStatus);
  const setTokens = useAuthStore((s) => s.setTokens);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!ready || status !== 'unknown') return;
    let cancelled = false;

    void (async () => {
      const legacy = takeLegacyRefreshToken();
      const path = audience === 'platform' ? '/owner/auth/refresh' : '/auth/refresh';
      try {
        const res = await api.post<RefreshResponse>(path, legacy ? { refreshToken: legacy } : {});
        if (cancelled) return;
        setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken, audience });
        if (res.me) {
          // Both shapes are in use across the consoles; seeding both means no
          // layout has to know where its `me` came from.
          queryClient.setQueryData(['me'], res.me);
          if (hostKey) queryClient.setQueryData(['me', hostKey], res.me);
        }
        dropLegacyRefreshToken();
      } catch {
        if (cancelled) return;
        // 401/403 here is the normal "not signed in" answer, not an error.
        dropLegacyRefreshToken();
        setStatus('anon');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, audience, ready, status, setStatus, setTokens, queryClient, hostKey]);
}
