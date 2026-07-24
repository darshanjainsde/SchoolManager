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

async function rawFetch(path: string, s: Session | null, opts: Opts) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s) {
    headers['X-Skoolos-Host'] = s.schoolHost;
    if (opts.auth !== false) headers['Authorization'] = `Bearer ${s.accessToken}`;
  }
  return fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function tryRefresh(s: Session): Promise<Session | null> {
  const res = await fetch(`${BASE}/auth/refresh`, {
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

  async login(host: string, identifier: string, password: string): Promise<Session> {
    const loginRes = await fetch(`${BASE}/auth/login`, {
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
    const meRes = await fetch(`${BASE}/auth/me`, {
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
};
