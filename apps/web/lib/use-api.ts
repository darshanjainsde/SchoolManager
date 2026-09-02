'use client';
import { useMemo } from 'react';
import { ApiClient } from './api';
import { useAuthStore } from './auth-store';

/**
 * One ApiClient per render-tree, bound to the current zustand auth slice. The
 * underlying client is `useMemo`'d so React Query's queryKeys stay stable; the
 * client mutates its own options via `setOptions` whenever the store changes.
 */
export function useApi(opts: {
  /**
   * REQUIRED KEY, nullable value — and the distinction is the whole point.
   *
   * Passing `hostHeader: host` while `useHost()` is still resolving is normal
   * and safe: the query waits on `enabled: !!host`. FORGETTING the key is not
   * safe — the request goes out with no X-Skoolos-Host, the API cannot resolve
   * the tenant, and the 401 that follows signs the user out mid-action. It
   * type-checks, lints, builds and renders fine, so nothing but this signature
   * catches it. RecordPaymentDialog shipped that way and signed a clerk out on
   * every counter payment.
   *
   * Platform surfaces pass the OWNER_HOST constant, which is always known.
   */
  hostHeader: string | undefined;
  audience?: 'school' | 'platform';
}) {
  const setTokens = useAuthStore((s) => s.setTokens);
  const clear = useAuthStore((s) => s.clear);

  const client = useMemo(() => {
    const c = new ApiClient({
      hostHeader: opts.hostHeader,
      audience: opts.audience,
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () => useAuthStore.getState().refreshToken,
      setTokens: ({ accessToken, refreshToken }) => {
        const aud = useAuthStore.getState().audience ?? opts.audience ?? 'school';
        setTokens({ accessToken, refreshToken, audience: aud });
      },
      onUnauthenticated: () => clear(),
    });
    return c;
    // We intentionally re-build the client when hostHeader/audience changes,
    // not when token state changes — token reads go through the getters above.
  }, [opts.hostHeader, opts.audience, setTokens, clear]);

  return client;
}
