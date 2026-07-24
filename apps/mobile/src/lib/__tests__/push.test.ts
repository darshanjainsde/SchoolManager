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
