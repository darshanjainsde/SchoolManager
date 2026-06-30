'use client';
import { create } from 'zustand';

/**
 * In-memory auth state for the owner portal AND tenant pages. The refresh
 * token is stored in localStorage (HttpOnly cookies would be better but
 * require server-side write — feasible only after the Vercel retarget that
 * the implementation plan calls out). Access token is held in memory only;
 * a refresh on every cold load pulls a fresh access token.
 */

export type Audience = 'school' | 'platform';

interface AuthState {
  accessToken?: string;
  refreshToken?: string;
  audience?: Audience;
  userId?: string;
  schoolId?: string;
  role?: string;
  setTokens: (t: { accessToken: string; refreshToken?: string; audience: Audience }) => void;
  setMe: (m: { userId: string; schoolId?: string; role?: string }) => void;
  clear: () => void;
}

const REFRESH_KEY = 'skoolos:refresh';
const REFRESH_AUD_KEY = 'skoolos:audience';

function loadRefresh(): { token?: string; audience?: Audience } {
  if (typeof window === 'undefined') return {};
  try {
    return {
      token: window.localStorage.getItem(REFRESH_KEY) ?? undefined,
      audience: (window.localStorage.getItem(REFRESH_AUD_KEY) as Audience | null) ?? undefined,
    };
  } catch {
    return {};
  }
}

function persistRefresh(token: string | undefined, audience: Audience | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    if (token && audience) {
      window.localStorage.setItem(REFRESH_KEY, token);
      window.localStorage.setItem(REFRESH_AUD_KEY, audience);
    } else {
      window.localStorage.removeItem(REFRESH_KEY);
      window.localStorage.removeItem(REFRESH_AUD_KEY);
    }
  } catch {
    /* storage might be blocked in private mode */
  }
}

const initial = loadRefresh();

export const useAuthStore = create<AuthState>((set) => ({
  refreshToken: initial.token,
  audience: initial.audience,
  setTokens: ({ accessToken, refreshToken, audience }) => {
    set({ accessToken, audience, refreshToken: refreshToken ?? undefined });
    if (refreshToken) persistRefresh(refreshToken, audience);
  },
  setMe: (m) => set(m),
  clear: () => {
    set({ accessToken: undefined, refreshToken: undefined, audience: undefined, userId: undefined, schoolId: undefined, role: undefined });
    persistRefresh(undefined, undefined);
  },
}));
