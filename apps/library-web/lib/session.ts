'use client';

/**
 * Where the tokens live, and the honest note about it.
 *
 * `localStorage` is readable by any script that gets onto the page, so an XSS
 * becomes a token theft. The sibling Sckools console makes the same trade and
 * documents it the same way: the mitigation is a strict CSP on console routes,
 * not the storage choice. httpOnly cookies would be genuinely better and are
 * a deliberate later change — they need the API to set and read them, which
 * is an API change, not a client one.
 *
 * What this file does NOT do is pretend otherwise. If you are reading it while
 * deciding whether to put something more sensitive here: don't.
 */

const ACCESS = 'lib.access';
const REFRESH = 'lib.refresh';
const HOST = 'lib.host';

export interface Session {
  accessToken: string;
  refreshToken: string;
  host: string;
}

/** Decoded, unverified. The API verifies; this is only for showing a name. */
export interface TokenClaims {
  sub: string;
  org: string;
  role: 'ORG_OWNER' | 'LIBRARIAN' | 'ASSISTANT' | 'MEMBER';
  branches: string[];
  exp?: number;
}

export function saveSession(s: Session): void {
  localStorage.setItem(ACCESS, s.accessToken);
  localStorage.setItem(REFRESH, s.refreshToken);
  localStorage.setItem(HOST, s.host);
}

export function readSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const accessToken = localStorage.getItem(ACCESS);
  const refreshToken = localStorage.getItem(REFRESH);
  const host = localStorage.getItem(HOST);
  if (!accessToken || !refreshToken || !host) return null;
  return { accessToken, refreshToken, host };
}

export function clearSession(): void {
  [ACCESS, REFRESH, HOST].forEach((k) => localStorage.removeItem(k));
}

/**
 * Reads the claims without verifying the signature — deliberately. The client
 * cannot verify anything the API has not already checked, and pretending to
 * would be theatre. This is used only to render a role chip and decide which
 * nav items to show; every actual permission is enforced server-side, where
 * three of the four guards fail open if the JWT guard has not run and the
 * authz matrix is the compensating control.
 */
export function readClaims(accessToken: string): TokenClaims | null {
  try {
    const [, payload] = accessToken.split('.');
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as TokenClaims;
  } catch {
    return null;
  }
}

/** True when the access token is expired or within `skewSeconds` of it. */
export function isExpired(claims: TokenClaims | null, skewSeconds = 30): boolean {
  if (!claims?.exp) return false;
  return claims.exp * 1000 - skewSeconds * 1000 <= Date.now();
}
