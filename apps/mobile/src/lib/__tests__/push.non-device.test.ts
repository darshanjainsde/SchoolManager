// Separate file: isDevice is mocked false at module scope for this whole file,
// since jest.mock factories are hoisted per-file and can't be safely mutated
// mid-suite once `expo-device` has been required by push.ts.
import { registerForPush } from '../push';
import { api } from '../api';
import * as Notifications from 'expo-notifications';

jest.mock('../api', () => ({ api: { request: jest.fn() } }));
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
}));

it('no-ops on a non-device (simulator/emulator) without requesting permission', async () => {
  await registerForPush();
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
});
