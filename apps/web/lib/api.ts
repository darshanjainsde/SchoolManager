/**
 * Single fetch wrapper used by every owner-portal and tenant page. Adds the
 * Host header (so the API's tenant middleware routes correctly when the web
 * app is calling the API from server components), surfaces JSON errors as
 * thrown ApiError instances, and refreshes access tokens on 401.
 *
 * Why a hand-rolled wrapper instead of a generated client: the API surface is
 * small, and shipping a generator across the workspace before Phase 7 is not
 * worth the friction. When phase 7's contract layer lands, this file becomes
 * the single place to swap.
 */

export interface ApiClientOptions {
  baseUrl?: string;
  hostHeader?: string;
  getAccessToken?: () => string | undefined;
  setTokens?: (t: { accessToken: string; refreshToken?: string }) => void;
  getRefreshToken?: () => string | undefined;
  onUnauthenticated?: () => void;
  audience?: 'school' | 'platform';
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiClient {
  private opts: ApiClientOptions;
  private refreshing: Promise<void> | null = null;

  constructor(opts: ApiClientOptions = {}) {
    this.opts = opts;
  }

  setOptions(patch: Partial<ApiClientOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const baseUrl = this.opts.baseUrl ?? DEFAULT_BASE;
    const headers = new Headers(init.headers);
    if (this.opts.hostHeader) headers.set('X-Forwarded-Host', this.opts.hostHeader);
    const token = this.opts.getAccessToken?.();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const url = baseUrl + path;
    const res = await fetch(url, { ...init, headers, credentials: 'include' });

    if (res.status === 401 && this.opts.getRefreshToken && this.opts.setTokens && !path.includes('/refresh')) {
      await this.refresh();
      const retryHeaders = new Headers(init.headers);
      if (this.opts.hostHeader) retryHeaders.set('X-Forwarded-Host', this.opts.hostHeader);
      const newToken = this.opts.getAccessToken?.();
      if (newToken) retryHeaders.set('Authorization', `Bearer ${newToken}`);
      if (init.body && !(init.body instanceof FormData) && !retryHeaders.has('Content-Type')) {
        retryHeaders.set('Content-Type', 'application/json');
      }
      const retry = await fetch(url, { ...init, headers: retryHeaders, credentials: 'include' });
      return parse<T>(retry);
    }

    return parse<T>(res);
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async del<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const refreshToken = this.opts.getRefreshToken?.();
    if (!refreshToken) {
      this.opts.onUnauthenticated?.();
      throw new ApiError(401, 'Unauthenticated', null);
    }
    const audience = this.opts.audience ?? 'school';
    const path = audience === 'platform' ? '/owner/auth/refresh' : '/auth/refresh';

    this.refreshing = (async () => {
      try {
        const baseUrl = this.opts.baseUrl ?? DEFAULT_BASE;
        const headers = new Headers({ 'Content-Type': 'application/json' });
        if (this.opts.hostHeader) headers.set('X-Forwarded-Host', this.opts.hostHeader);
        const res = await fetch(baseUrl + path, {
          method: 'POST',
          headers,
          body: JSON.stringify({ refreshToken }),
          credentials: 'include',
        });
        if (!res.ok) {
          this.opts.onUnauthenticated?.();
          throw new ApiError(res.status, 'Refresh failed', await res.text());
        }
        const body = (await res.json()) as { accessToken: string; refreshToken: string };
        this.opts.setTokens?.({ accessToken: body.accessToken, refreshToken: body.refreshToken });
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    let msg: string;
    if (body && typeof body === 'object' && 'message' in body) {
      msg = String((body as { message: unknown }).message);
    } else {
      msg = res.statusText || `HTTP ${res.status}`;
    }
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
