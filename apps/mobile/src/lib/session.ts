import * as SecureStore from 'expo-secure-store';
import { clearCache } from './cache-store';

export type Role = 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'STAFF' | 'LIBRARIAN' | 'OWNER';

export interface Session {
  accessToken: string;
  refreshToken: string;
  role: Role;
  schoolHost: string; // e.g. "raffles.sckools.com"
  displayName: string;
  /**
   * The school's switched-on modules from `GET /auth/me` (FEES, LIBRARY,
   * SPORTS, PRESS…). Optional: a session persisted before this field existed
   * has none, and every feature check then answers "no" until the next
   * sign-in. See lib/features.ts.
   */
  features?: string[];
}

const KEY = 'sckools.session';
const HOST_KEY = 'sckools.schoolHost';

/**
 * Who the cache belongs to. A token refresh rewrites the session for the SAME
 * person and must keep the cache; a shelf switch or sign-in rewrites it for a
 * DIFFERENT one and must drop it — a cached fees page from one child shown
 * under a sibling's name is the one failure the cache is not allowed.
 */
let identity: string | null = null;
const identityOf = (s: Session) => `${s.schoolHost}::${s.displayName}`;

export const session = {
  async get(): Promise<Session | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    if (s && identity === null) identity = identityOf(s);
    return s;
  },
  async set(s: Session): Promise<void> {
    const next = identityOf(s);
    if (identity !== null && identity !== next) clearCache();
    identity = next;
    await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  },
  async clear(): Promise<void> {
    identity = null;
    clearCache();
    await SecureStore.deleteItemAsync(KEY);
  },
  async setSchoolHost(host: string): Promise<void> {
    await SecureStore.setItemAsync(HOST_KEY, host);
  },
  async getSchoolHost(): Promise<string | null> {
    return SecureStore.getItemAsync(HOST_KEY);
  },
};
