import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSessionProbe } from './use-session-probe';
import { useAuthStore } from './auth-store';
import type { ApiClient } from './api';

/**
 * The boot probe seeds `me` into the query cache.
 *
 * A console boot was refresh -> /auth/me -> the page's own queries, serially,
 * and the layouts render nothing until the first two land. POST /auth/refresh
 * now answers both questions at once; this is the half that makes the layouts
 * notice, WITHOUT any of them changing their query.
 *
 * The fallback matters as much as the win: an API deployed before the field
 * existed, or the owner console's own refresh endpoint, sends no `me`, and
 * every layout must go on fetching it exactly as before.
 */
const ME = { userId: 'u1', schoolId: 's1', role: 'SCHOOL_ADMIN', name: 'Dr A', staffRole: null, features: ['FEES'] };

function harness(post: ReturnType<typeof vi.fn>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = { post } as unknown as ApiClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, api, wrapper };
}

beforeEach(() => {
  useAuthStore.setState({ status: 'unknown', accessToken: undefined, audience: undefined });
});

describe('the boot probe seeds me', () => {
  it('fills both cache shapes so no layout fetches /auth/me', async () => {
    const post = vi.fn().mockResolvedValue({ accessToken: 'a', me: ME });
    const { client, api, wrapper } = harness(post);

    renderHook(() => useSessionProbe(api, 'school', true, 'raffles.sckools.com'), { wrapper });

    await waitFor(() => expect(client.getQueryData(['me'])).toEqual(ME));
    expect(client.getQueryData(['me', 'raffles.sckools.com'])).toEqual(ME);
    expect(useAuthStore.getState().status).toBe('authed');
    // One call. The whole point is that there is no second one.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/auth/refresh', {});
  });

  it('seeded data is fresh, so a layout query does not refetch', async () => {
    const post = vi.fn().mockResolvedValue({ accessToken: 'a', me: ME });
    const { client, api, wrapper } = harness(post);
    renderHook(() => useSessionProbe(api, 'school', true, 'raffles.sckools.com'), { wrapper });
    await waitFor(() => expect(client.getQueryData(['me'])).toEqual(ME));

    const state = client.getQueryState(['me']);
    expect(state?.dataUpdatedAt).toBeGreaterThan(0);
    expect(state?.status).toBe('success');
  });

  it('an API that sends no me leaves the cache alone', async () => {
    const post = vi.fn().mockResolvedValue({ accessToken: 'a' });
    const { client, api, wrapper } = harness(post);

    renderHook(() => useSessionProbe(api, 'school', true, 'raffles.sckools.com'), { wrapper });

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authed'));
    expect(client.getQueryData(['me'])).toBeUndefined();
    expect(client.getQueryData(['me', 'raffles.sckools.com'])).toBeUndefined();
  });

  it('the platform audience refreshes on its own endpoint and seeds nothing', async () => {
    const post = vi.fn().mockResolvedValue({ accessToken: 'a' });
    const { client, api, wrapper } = harness(post);

    renderHook(() => useSessionProbe(api, 'platform', true), { wrapper });

    await waitFor(() => expect(post).toHaveBeenCalledWith('/owner/auth/refresh', {}));
    expect(client.getQueryData(['me'])).toBeUndefined();
  });

  it('a rejected refresh still resolves the session to anon', async () => {
    const post = vi.fn().mockRejectedValue(new Error('401'));
    const { client, api, wrapper } = harness(post);

    renderHook(() => useSessionProbe(api, 'school', true, 'raffles.sckools.com'), { wrapper });

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anon'));
    expect(client.getQueryData(['me'])).toBeUndefined();
  });
});
