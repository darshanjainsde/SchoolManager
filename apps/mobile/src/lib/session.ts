import * as SecureStore from 'expo-secure-store';

export type Role = 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'STAFF' | 'LIBRARIAN' | 'OWNER';

export interface Session {
  accessToken: string;
  refreshToken: string;
  role: Role;
  schoolHost: string; // e.g. "raffles.sckools.com"
  displayName: string;
}

const KEY = 'sckools.session';
const HOST_KEY = 'sckools.schoolHost';

export const session = {
  async get(): Promise<Session | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  },
  async set(s: Session): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  },
  async setSchoolHost(host: string): Promise<void> {
    await SecureStore.setItemAsync(HOST_KEY, host);
  },
  async getSchoolHost(): Promise<string | null> {
    return SecureStore.getItemAsync(HOST_KEY);
  },
};
