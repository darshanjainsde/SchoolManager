import { registerForPush } from '../push';
import { api } from '../api';

jest.mock('../api', () => ({ api: { request: jest.fn() } }));
jest.mock('expo-device', () => ({ isDevice: true }));
const perms = { status: 'granted' };
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => perms),
  requestPermissionsAsync: jest.fn(async () => perms),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[xyz]' })),
  setNotificationHandler: jest.fn(),
  // Kept outside the mock's call log: beforeEach clears calls, and the listener is registered once, at import.
  addNotificationReceivedListener: (fn: () => void) => {
    (globalThis as { __pushReceived?: () => void }).__pushReceived = fn;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  perms.status = 'granted';
});

it('registers the token when permission granted', async () => {
  await registerForPush();
  expect(api.request).toHaveBeenCalledWith('/me/push-token', {
    method: 'POST',
    body: { token: 'ExponentPushToken[xyz]', platform: expect.any(String) },
  });
});

it('never throws when the API call fails', async () => {
  (api.request as jest.Mock).mockRejectedValueOnce(new Error('down'));
  await expect(registerForPush()).resolves.toBeUndefined();
});

it('does not call the API when permission is denied', async () => {
  perms.status = 'denied';
  await registerForPush();
  expect(api.request).not.toHaveBeenCalled();
});

describe('a push arriving while the app is open', () => {
  it('marks everything on screen stale, so it asks the server again', () => {
    const cache = jest.requireActual('@/lib/cache-store') as typeof import('@/lib/cache-store');
    cache.store.set('/manage/leave/coverage', { data: [], at: Date.now() });
    const listener = (globalThis as { __pushReceived?: () => void }).__pushReceived;
    expect(listener).toBeDefined();
    listener!();
    expect(cache.store.get('/manage/leave/coverage')!.at).toBe(0);
  });
});

