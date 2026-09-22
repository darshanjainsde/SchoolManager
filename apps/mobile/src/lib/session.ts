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

/**
 * IN-MEMORY COPY. `SecureStore.getItemAsync` is a Keystore decrypt over the
 * bridge (3–20 ms on a mid-range Android), and every API request used to pay
 * it — six decrypts before the five requests of a Home focus could even
 * leave the device (perf audit 2026-09-22, #1). The parsed session lives here
 * after the first read; `set`/`clear` keep it true. `undefined` = not read yet.
 */
let memo: Session | null | undefined;
let hostMemo: string | null | undefined;

export const session = {
  async get(): Promise<Session | null> {
    if (memo !== undefined) return memo;
    const raw = await SecureStore.getItemAsync(KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    if (s && identity === null) identity = identityOf(s);
    memo = s;
    return s;
  },
  async set(s: Session): Promise<void> {
    const next = identityOf(s);
    if (identity !== null && identity !== next) clearCache();
    identity = next;
    memo = s;
    await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  },
  async clear(): Promise<void> {
    identity = null;
    memo = null;
    clearCache();
    await SecureStore.deleteItemAsync(KEY);
  },
  async setSchoolHost(host: string): Promise<void> {
    hostMemo = host;
    await SecureStore.setItemAsync(HOST_KEY, host);
  },
  async getSchoolHost(): Promise<string | null> {
    if (hostMemo !== undefined) return hostMemo;
    hostMemo = await SecureStore.getItemAsync(HOST_KEY);
    return hostMemo;
  },
  /** Drop the in-memory copies so the next read goes to the store (tests, and a store written behind our back). */
  forget(): void {
    memo = undefined;
    hostMemo = undefined;
  },
};
