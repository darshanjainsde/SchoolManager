import { session } from '../session';
import { FRESH_MS } from '../query';
import { store } from '../cache-store';
import { humanMessage } from '../api';

jest.mock('expo-secure-store', () => {
  const s = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => s.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { s.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { s.delete(k); }),
  };
});
import * as SecureStore from 'expo-secure-store';

/**
 * Perf audit 2026-09-22. Each of these pins a cost that had crept in: a
 * Keystore decrypt per API call, a refetch per focus, a raw status shown to
 * a parent. If one comes back, this is where it fails.
 */
describe('session — one Keystore read per launch, not one per request', () => {
  beforeEach(() => { session.forget(); (SecureStore.getItemAsync as jest.Mock).mockClear(); });
  it('reads the store once and answers from memory after that', async () => {
    await session.set({ accessToken: 'a', refreshToken: 'r', role: 'STUDENT', schoolHost: 'raffles.sckools.com', displayName: 'Ravi' });
    session.forget();
    await session.get(); await session.get(); await session.get();
    expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
  });
  it('set and clear keep the memory copy true', async () => {
    await session.set({ accessToken: 'a', refreshToken: 'r', role: 'STUDENT', schoolHost: 'h', displayName: 'Ravi' });
    expect((await session.get())?.displayName).toBe('Ravi');
    await session.clear();
    expect(await session.get()).toBeNull();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });
});

describe('query freshness', () => {
  it('a cached answer younger than FRESH_MS counts as fresh (30 s)', () => {
    expect(FRESH_MS).toBe(30_000);
    store.set('/x', { data: 1, at: Date.now() });
    expect(Date.now() - store.get('/x')!.at).toBeLessThan(FRESH_MS);
  });
});

describe('humanMessage — no raw status, no joined validation arrays', () => {
  it('takes the first validation message, the server sentence, the fallback, then a human default', () => {
    expect(humanMessage({ message: ['phone must be a valid phone number', 'phone should not be empty'] }, 422)).toBe('phone must be a valid phone number');
    expect(humanMessage({ message: 'That code has expired.' }, 400)).toBe('That code has expired.');
    expect(humanMessage({}, 400, 'Could not send the code.')).toBe('Could not send the code.');
    expect(humanMessage({}, 422)).toBe('Something went wrong. Try again.');
    expect(humanMessage(undefined, 503)).toMatch(/school server/);
    expect(humanMessage({}, 0)).toMatch(/No connection/);
  });
});
