import { api, ApiError } from '../api';
import { session } from '../session';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const seed = async () =>
  session.set({
    accessToken: 'at1', refreshToken: 'rt1', role: 'TEACHER',
    schoolHost: 'raffles.sckools.com', displayName: 'Ms. Rao',
  });

beforeEach(() => { mockFetch.mockReset(); });

it('attaches tenant host and bearer token', async () => {
  await seed();
  mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
  await api.request('/me/profile');
  const [, init] = mockFetch.mock.calls[0];
  expect(init.headers['X-Skoolos-Host']).toBe('raffles.sckools.com');
  expect(init.headers['Authorization']).toBe('Bearer at1');
});

it('refreshes once on 401 then retries', async () => {
  await seed();
  mockFetch
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accessToken: 'at2', refreshToken: 'rt2', expiresIn: 900 }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
  const out = await api.request<{ ok: number }>('/me/profile');
  expect(out.ok).toBe(1);
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect((await session.get())?.accessToken).toBe('at2');
  // MINOR 2: the retried request must carry the NEW token, not the stale one.
  const [, retryInit] = mockFetch.mock.calls[2];
  expect(retryInit.headers['Authorization']).toBe('Bearer at2');
});

it('throws ApiError and clears session when refresh also fails', async () => {
  await seed();
  mockFetch
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
  await expect(api.request('/me/profile')).rejects.toBeInstanceOf(ApiError);
  expect(await session.get()).toBeNull();
});

// MINOR 1: an offline/DNS failure (fetch rejects) must surface as an ApiError,
// not a raw TypeError, so callers only ever need to catch one error type.
it('normalizes a network failure to ApiError', async () => {
  await seed();
  mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
  await expect(api.request('/me/profile')).rejects.toBeInstanceOf(ApiError);
});

// IMPORTANT: the backend rotates refresh tokens on every use and revokes the
// whole token family if a stale refresh token is replayed (reuse detection —
// see auth.service.ts refresh()). Two api.request() calls racing on an
// expired access token must NOT each fire their own /auth/refresh with the
// same (soon-to-be-stale) refresh token — only one refresh call may happen,
// and the second caller must reuse its result.
it('single-flights concurrent refreshes on 401 instead of double-refreshing', async () => {
  await seed();
  mockFetch.mockImplementation(async (url: string, init: any) => {
    if (url.includes('/auth/refresh')) {
      return {
        ok: true, status: 200,
        json: async () => ({ accessToken: 'at2', refreshToken: 'rt2', expiresIn: 900 }),
      };
    }
    if (init.headers['Authorization'] === 'Bearer at1') {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
  });

  const [r1, r2] = await Promise.all([
    api.request<{ ok: number }>('/me/profile'),
    api.request<{ ok: number }>('/me/other'),
  ]);

  expect(r1.ok).toBe(1);
  expect(r2.ok).toBe(1);
  const refreshCalls = mockFetch.mock.calls.filter(([url]: [string]) => url.includes('/auth/refresh'));
  expect(refreshCalls.length).toBe(1);
  expect((await session.get())?.accessToken).toBe('at2');
});

// api.upload() is the multipart sibling of api.request(): same auth + tenant
// headers and 401-refresh-retry, but the FormData body must pass through
// untouched and Content-Type must NOT be set manually — fetch generates the
// multipart boundary itself, and a hand-set header would omit it.
describe('api.upload()', () => {
  it('POSTs the FormData as-is with tenant host + bearer token and NO manual Content-Type', async () => {
    await seed();
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ assetId: 'asset-1', photoUrl: 'https://cdn.example.com/a.jpg' }),
    });

    const form = new FormData();
    const out = await api.upload<{ assetId: string; photoUrl: string }>('/me/photo', form);

    expect(out.photoUrl).toBe('https://cdn.example.com/a.jpg');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/me/photo');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(form);
    expect(init.headers['X-Skoolos-Host']).toBe('raffles.sckools.com');
    expect(init.headers['Authorization']).toBe('Bearer at1');
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('refreshes once on 401 then retries with the new token', async () => {
    await seed();
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accessToken: 'at2', refreshToken: 'rt2', expiresIn: 900 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ assetId: 'asset-1', photoUrl: 'u' }) });

    const out = await api.upload<{ assetId: string }>('/me/photo', new FormData());

    expect(out.assetId).toBe('asset-1');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [, retryInit] = mockFetch.mock.calls[2];
    expect(retryInit.headers['Authorization']).toBe('Bearer at2');
  });

  it('surfaces the server error message as ApiError', async () => {
    await seed();
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 413, json: async () => ({ message: 'Keep photos under 2MB' }),
    });
    await expect(api.upload('/me/photo', new FormData())).rejects.toThrow('Keep photos under 2MB');
  });
});

// The real POST /auth/login response is `{ accessToken, refreshToken, expiresIn }`
// with no embedded user object (see apps/api/src/modules/auth/internal/auth.service.ts
// `IssuedTokens` and auth.controller.ts `login`/`refresh`). Role is only available via
// GET /auth/me (`{ userId, schoolId, role, features }`), which also has no display name,
// so api.login must chain a login call with a /auth/me call and fall back to the
// identifier for displayName.
it('login() exchanges credentials, fetches role from /auth/me, and stores the session', async () => {
  mockFetch
    .mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresIn: 900 }),
    })
    .mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ userId: 'u1', schoolId: 's1', role: 'TEACHER', features: [] }),
    });

  const s = await api.login('raffles.sckools.com', 'rao@raffles.sckools.com', 'hunter2');

  expect(s).toEqual({
    accessToken: 'at1',
    refreshToken: 'rt1',
    role: 'TEACHER',
    schoolHost: 'raffles.sckools.com',
    displayName: 'rao@raffles.sckools.com',
  });

  const [loginUrl, loginInit] = mockFetch.mock.calls[0];
  expect(loginUrl).toContain('/auth/login');
  expect(loginInit.headers['X-Skoolos-Host']).toBe('raffles.sckools.com');
  expect(JSON.parse(loginInit.body)).toEqual({ identifier: 'rao@raffles.sckools.com', password: 'hunter2' });

  const [meUrl, meInit] = mockFetch.mock.calls[1];
  expect(meUrl).toContain('/auth/me');
  expect(meInit.headers['X-Skoolos-Host']).toBe('raffles.sckools.com');
  expect(meInit.headers['Authorization']).toBe('Bearer at1');

  expect(await session.get()).toEqual(s);
});

it('login() throws ApiError on invalid credentials without touching /auth/me', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false, status: 401, json: async () => ({ message: 'Invalid credentials' }),
  });
  await expect(api.login('raffles.sckools.com', 'bad@raffles.sckools.com', 'wrong')).rejects.toBeInstanceOf(ApiError);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

// T5: mirrors the web's `handleLogout` (apps/web/app/teacher/layout.tsx) —
// revoke the refresh token server-side before the caller wipes local state,
// so a lost/stolen device doesn't stay signed in until the token expires on
// its own. Unlike the web (cookie-authenticated), POST /auth/logout is
// behind SchoolJwtGuard on this bearer-token client, so the access token
// MUST be attached or the server 401s and never revokes anything.
describe('api.logout()', () => {
  it('POSTs /auth/logout with the tenant host, bearer token, and the stored refreshToken', async () => {
    await seed();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await api.logout();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/auth/logout');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Skoolos-Host']).toBe('raffles.sckools.com');
    expect(init.headers['Authorization']).toBe('Bearer at1');
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'rt1' });
  });

  it('makes no request when no session exists — there is nothing to revoke', async () => {
    // Earlier tests in this file seed a session into the shared mock
    // SecureStore, which is not reset between tests — clear it explicitly
    // rather than relying on test order.
    await session.clear();
    await api.logout();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Prove-by-deletion target: this is the test that must fail if
  // `.catch(() => undefined)` is removed from api.logout() in api.ts. With
  // the swallow in place, a rejected POST resolves api.logout() cleanly so
  // the caller's subsequent `session.clear()` always runs.
  it('swallows a network failure instead of rejecting, so a caller awaiting it is never blocked', async () => {
    await seed();
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(api.logout()).resolves.toBeUndefined();
  });
});
