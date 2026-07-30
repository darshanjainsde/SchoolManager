import { render, fireEvent, waitFor } from '@testing-library/react-native';
import More from '../more';
import { session } from '@/lib/session';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(async () => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await session.set({
    accessToken: 'at', refreshToken: 'rt', role: 'STUDENT',
    schoolHost: 'raffles.sckools.com', displayName: 'A Student',
  });
});

it('navigates to the holidays screen', async () => {
  const { findByText } = render(<More />);

  fireEvent.press(await findByText('Holidays'));

  expect(mockPush).toHaveBeenCalledWith('/(family)/holidays');
});

/**
 * Regression net for F2 (no logout affordance): there was previously no
 * user-initiated way to sign out, which blocked closed-test testers from
 * switching roles/schools on the same device.
 */
it('logging out clears the session and routes to the connect screen', async () => {
  const { findByText } = render(<More />);

  fireEvent.press(await findByText('Log out'));

  await waitFor(async () => {
    expect(await session.get()).toBeNull();
  });
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/connect');
});

/**
 * T5: real logout. The server-side revocation must happen BEFORE the local
 * session is wiped — mirrors the web's `handleLogout`
 * (apps/web/app/teacher/layout.tsx).
 */
it('logging out POSTs /auth/logout with the refreshToken before clearing the local session', async () => {
  const order: string[] = [];
  mockFetch.mockImplementation(async () => {
    order.push('fetch');
    expect(await session.get()).not.toBeNull();
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  const { findByText } = render(<More />);
  fireEvent.press(await findByText('Log out'));

  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  const [url, init] = mockFetch.mock.calls[0];
  expect(url).toContain('/auth/logout');
  expect(JSON.parse(init.body)).toEqual({ refreshToken: 'rt' });

  await waitFor(async () => {
    order.push('cleared');
    expect(await session.get()).toBeNull();
  });
  expect(order.indexOf('fetch')).toBeLessThan(order.lastIndexOf('cleared'));
});

/**
 * Prove-by-deletion target: an offline device must still be able to sign out
 * locally. Exercises the same `.catch(() => undefined)` swallow in
 * api.logout() as the staff More screen's equivalent test.
 */
it('still clears the session and navigates when the logout POST fails (offline device)', async () => {
  mockFetch.mockRejectedValue(new TypeError('Network request failed'));

  const { findByText } = render(<More />);
  fireEvent.press(await findByText('Log out'));

  await waitFor(async () => {
    expect(await session.get()).toBeNull();
  });
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/connect');
});
