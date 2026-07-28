'use client';
import { useEffect } from 'react';
import type { ApiClient } from './api';
import { useAuthStore, takeLegacyRefreshToken, dropLegacyRefreshToken, type Audience } from './auth-store';

interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
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
 * @param ready pass false while the tenant host is still unknown — a school
 *              refresh without the host header cannot resolve its tenant.
 */
export function useSessionProbe(api: ApiClient, audience: Audience, ready = true): void {
  const status = useAuthStore((s) => s.status);
  const setStatus = useAuthStore((s) => s.setStatus);
  const setTokens = useAuthStore((s) => s.setTokens);

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
  }, [api, audience, ready, status, setStatus, setTokens]);
}
