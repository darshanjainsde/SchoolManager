'use client';
import { create } from 'zustand';

/**
 * In-memory auth state for the owner portal AND tenant pages.
 *
 * The refresh token is NO LONGER persisted here: the API now returns it as an
 * HttpOnly cookie scoped to `.sckools.com`, which JavaScript cannot read — so
 * an XSS on any tenant site can no longer lift a long-lived session. The copy
 * kept in this store lives in memory only, for the tab's lifetime.
 *
 * Because the cookie is invisible to JS, "am I signed in?" can no longer be
 * answered synchronously at boot. `status` carries that: it starts `unknown`,
 * and the session probe in each console layout resolves it to `authed`/`anon`
 * by asking the API to refresh. Gate on `status`, never on `refreshToken`
 * alone — the latter is empty until the probe answers.
 */

export type Audience = 'school' | 'platform';

/** `unknown` until the boot probe answers — see the note above. */
export type SessionStatus = 'unknown' | 'authed' | 'anon';

interface AuthState {
  accessToken?: string;
  refreshToken?: string;
  audience?: Audience;
  userId?: string;
  schoolId?: string;
  role?: string;
  status: SessionStatus;
  setStatus: (s: SessionStatus) => void;
  setTokens: (t: { accessToken: string; refreshToken?: string; audience: Audience }) => void;
  setMe: (m: { userId: string; schoolId?: string; role?: string }) => void;
  clear: () => void;
}

const REFRESH_KEY = 'skoolos:refresh';
const REFRESH_AUD_KEY = 'skoolos:audience';

/**
 * A refresh token left in localStorage by a build from before the cookie
 * existed. It is sent once, on the next refresh, so that session survives the
 * upgrade — then dropped. Nothing ever writes these keys again.
 */
export function takeLegacyRefreshToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(REFRESH_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function dropLegacyRefreshToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(REFRESH_AUD_KEY);
  } catch {
    /* storage might be blocked in private mode */
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  setStatus: (status) => set({ status }),
  setTokens: ({ accessToken, refreshToken, audience }) => {
    // The durable copy of refreshToken is the HttpOnly cookie the API set on
    // this same response; what we keep here is a per-tab convenience.
    set({ accessToken, audience, refreshToken: refreshToken ?? undefined, status: 'authed' });
    dropLegacyRefreshToken();
  },
  setMe: (m) => set(m),
  clear: () => {
    set({
      accessToken: undefined,
      refreshToken: undefined,
      audience: undefined,
      userId: undefined,
      schoolId: undefined,
      role: undefined,
      status: 'anon',
    });
    dropLegacyRefreshToken();
  },
}));
