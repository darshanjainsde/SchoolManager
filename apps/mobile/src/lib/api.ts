import Constants from 'expo-constants';
import { session, type Session } from './session';

const BASE = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Opts { method?: string; body?: unknown; auth?: boolean }

// Shape returned by both POST /auth/login and POST /auth/refresh — see
// `IssuedTokens` in apps/api/src/modules/auth/internal/auth.service.ts. Neither
// endpoint embeds a user object; role/name are NOT part of this response.
interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Shape returned by GET /auth/me — see AuthController#me in
// apps/api/src/modules/auth/internal/auth.controller.ts. No display name is
// available anywhere in the auth contract, so callers fall back to the
// identifier the user logged in with.
interface MeResponse {
  userId: string;
  schoolId: string;
  role: Session['role'];
  features: string[];
}

// MINOR 1: fetch rejects (offline, DNS failure, ...) with a raw TypeError.
// Normalize every network call through here so callers only ever see ApiError.
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(0, 'Could not reach the school server.');
  }
}

// Multipart sibling of rawFetch: same auth + tenant headers, but the body is
// FormData and Content-Type is deliberately NOT set — fetch must generate the
// multipart boundary itself, and a manual header would omit it (the server
// would then see an unparseable body).
async function rawUpload(path: string, s: Session | null, form: FormData) {
  const headers: Record<string, string> = {};
  if (s) {
    headers['X-Skoolos-Host'] = s.schoolHost;
    headers['Authorization'] = `Bearer ${s.accessToken}`;
  }
  return safeFetch(`${BASE}${path}`, { method: 'POST', headers, body: form });
}

async function rawFetch(path: string, s: Session | null, opts: Opts) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s) {
    headers['X-Skoolos-Host'] = s.schoolHost;
    if (opts.auth !== false) headers['Authorization'] = `Bearer ${s.accessToken}`;
  }
  return safeFetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

// IMPORTANT: the backend rotates refresh tokens per use and revokes the whole
// token family if a stale refresh token is replayed (reuse detection — see
// AuthService.refresh in apps/api/src/modules/auth/internal/auth.service.ts,
// lines ~82-95). Two api.request() calls racing on an expired access token
// must not each spend the same refresh token — single-flight the refresh so
// concurrent 401s share one in-flight /auth/refresh call and its result.
let refreshInFlight: Promise<Session | null> | null = null;

async function doRefresh(s: Session): Promise<Session | null> {
  const res = await safeFetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Skoolos-Host': s.schoolHost },
    body: JSON.stringify({ refreshToken: s.refreshToken }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as IssuedTokens;
  const next: Session = { ...s, accessToken: data.accessToken, refreshToken: data.refreshToken };
  await session.set(next);
  return next;
}

async function tryRefresh(s: Session): Promise<Session | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh(s).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export const api = {
  async request<T>(path: string, opts: Opts = {}): Promise<T> {
    let s = await session.get();
    let res = await rawFetch(path, s, opts);
    if (res.status === 401 && s) {
      const refreshed = await tryRefresh(s);
      if (!refreshed) {
        await session.clear();
        throw new ApiError(401, 'Session expired — please log in again.');
      }
      s = refreshed;
      res = await rawFetch(path, s, opts);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
  },

  /**
   * POSTs multipart FormData (file uploads — e.g. POST /me/photo). Mirrors
   * request()'s 401-refresh-retry exactly; only the body encoding differs.
   * api.request can't be reused because it JSON-encodes every body.
   */
  async upload<T>(path: string, form: FormData): Promise<T> {
    let s = await session.get();
    let res = await rawUpload(path, s, form);
    if (res.status === 401 && s) {
      const refreshed = await tryRefresh(s);
      if (!refreshed) {
        await session.clear();
        throw new ApiError(401, 'Session expired — please log in again.');
      }
      s = refreshed;
      res = await rawUpload(path, s, form);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
  },

  /**
   * Starts a password reset from a STUDENT CODE alone (Phase 5·1's
   * `POST /auth/reset-by-code`), for the family who has the code the school
   * printed but not the email it was issued against.
   *
   * Takes `host` explicitly rather than going through `request()`: that helper
   * only sends `X-Skoolos-Host` when there is a stored session, and this call
   * happens before anyone is signed in. Mirrors `login()` for the same reason.
   *
   * `emailMasked` is null when the code resolves to no login/email on file —
   * the caller shows "ask the school office" rather than a false success.
   */
  async resetByCode(host: string, code: string): Promise<{ ok: true; emailMasked: string | null }> {
    const res = await safeFetch(`${BASE}/auth/reset-by-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Skoolos-Host': host },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? 'Could not start a reset for that code.');
    }
    return res.json() as Promise<{ ok: true; emailMasked: string | null }>;
  },

  async login(host: string, identifier: string, password: string): Promise<Session> {
    const loginRes = await safeFetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Skoolos-Host': host },
      body: JSON.stringify({ identifier, password }),
    });
    if (!loginRes.ok) {
      const body = await loginRes.json().catch(() => ({}));
      throw new ApiError(loginRes.status, body.message ?? 'Login failed — check your details.');
    }
    const tokens = (await loginRes.json()) as IssuedTokens;

    // The login response carries no role/name — fetch the role from /auth/me
    // using the freshly issued access token.
    const meRes = await safeFetch(`${BASE}/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Skoolos-Host': host,
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    if (!meRes.ok) {
      const body = await meRes.json().catch(() => ({}));
      throw new ApiError(meRes.status, body.message ?? 'Login failed — could not load profile.');
    }
    const me = (await meRes.json()) as MeResponse;

    const s: Session = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      role: me.role,
      schoolHost: host,
      displayName: identifier,
    };
    await session.set(s);
    await session.setSchoolHost(host);
    return s;
  },

  // Mirrors the web's `handleLogout` (apps/web/app/teacher/layout.tsx):
  // revoke the refresh token server-side before wiping local state, so a
  // lost/stolen device doesn't stay signed in until the token expires on its
  // own. Unlike the web (which is cookie-authenticated, so the request needs
  // no Authorization header), this app is bearer-token-authenticated and
  // POST /auth/logout is behind SchoolJwtGuard — the access token must be
  // attached or the server 401s and never revokes anything.
  //
  // Best-effort: a network failure here must never block the caller from
  // clearing the local session, so the request is swallowed with
  // `.catch(() => undefined)`, exactly like the web does. If no session
  // exists there is nothing to revoke, so no request is made at all.
  async logout(): Promise<void> {
    const s = await session.get();
    if (!s) return;
    await safeFetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Skoolos-Host': s.schoolHost,
        Authorization: `Bearer ${s.accessToken}`,
      },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    }).catch(() => undefined);
  },
};
