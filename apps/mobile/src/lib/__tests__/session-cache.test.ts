import { session } from '../session';
import { readCache, store } from '../cache-store';

jest.mock('expo-secure-store', () => {
  const mem = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => mem.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void mem.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void mem.delete(k)),
  };
});

const base = { accessToken: 'a', refreshToken: 'r', role: 'STUDENT' as const, schoolHost: 'raffles.sckools.com' };

describe('the cache follows the person, not the token', () => {
  beforeEach(() => store.clear());

  it('a token refresh for the same person keeps the cache', async () => {
    await session.set({ ...base, displayName: 'Aarav Sharma' });
    store.set('/me/fees', { data: { owed: 1 }, at: 0 });
    await session.set({ ...base, displayName: 'Aarav Sharma', accessToken: 'a2', refreshToken: 'r2' });
    expect(readCache('/me/fees')).toEqual({ owed: 1 });
  });

  it('switching to a sibling drops it', async () => {
    await session.set({ ...base, displayName: 'Aarav Sharma' });
    store.set('/me/fees', { data: { owed: 1 }, at: 0 });
    await session.set({ ...base, displayName: 'Diya Sharma' });
    expect(readCache('/me/fees')).toBeUndefined();
  });

  it('signing out drops it', async () => {
    await session.set({ ...base, displayName: 'Aarav Sharma' });
    store.set('/me/home', { data: {}, at: 0 });
    await session.clear();
    expect(readCache('/me/home')).toBeUndefined();
  });
});
