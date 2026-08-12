/**
 * The one place this app talks to the library API.
 *
 * Two things every call must carry, both easy to forget and both silent when
 * missing:
 *
 *  1. `X-Library-Host` — the API resolves the tenant from this header, not
 *     from the URL, because Vercel's ingress overwrites `X-Forwarded-Host`.
 *     Omit it and every request resolves to `{ kind: 'unknown' }` and 401s
 *     with no clue why.
 *  2. The bearer token, whose org must match the host-resolved org — the API
 *     rejects a valid token presented against another tenant's host. That is
 *     the control that makes the unauthenticated host header safe, so this
 *     client must never send the two from different tenants.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  /** Tenant host, e.g. `raffles.library.trackyour.in`. */
  host: string;
  token?: string;
  signal?: AbortSignal;
  /** Set for a write that must not be applied twice if the client retries. */
  idempotencyKey?: string;
}

const BASE = process.env.NEXT_PUBLIC_LIBRARY_API_URL ?? 'http://127.0.0.1:3101';

export async function apiFetch<T>(
  path: string,
  init: RequestInit & ApiOptions,
): Promise<T> {
  const { host, token, idempotencyKey, ...rest } = init;

  const headers = new Headers(rest.headers);
  headers.set('X-Library-Host', host);
  if (!headers.has('content-type') && rest.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);

  const res = await fetch(`${BASE}${path}`, { ...rest, headers, cache: 'no-store' });

  // 204 and friends have no body; parsing them throws a confusing syntax error
  // that reads like a server fault rather than an empty response.
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, messageFrom(body) ?? `${res.status} ${res.statusText}`, body);
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

/**
 * Nest's exception filter puts the human-readable part in `message`, which is
 * a string for most throws and an array for a failed `ValidationPipe`. Falling
 * back to the raw status text is what stops a validation error rendering as
 * "400 Bad Request" with the actual field problem thrown away.
 */
function messageFrom(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const m = (body as { message?: unknown }).message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m) && m.length) return m.join(', ');
  return undefined;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

export function login(host: string, identifier: string, password: string): Promise<LoginResult> {
  return apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    host,
    body: JSON.stringify({ identifier, password }),
  });
}

export function refresh(host: string, refreshToken: string): Promise<LoginResult> {
  return apiFetch<LoginResult>('/auth/refresh', {
    method: 'POST',
    host,
    body: JSON.stringify({ refreshToken }),
  });
}
