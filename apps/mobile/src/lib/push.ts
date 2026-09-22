import { InteractionManager, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { session } from './session';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
    shouldShowBanner: true, shouldShowList: true,
  }),
});

// The last token POSTed, per person — the same token was re-issued and
// re-POSTed on every launch and every shelf switch (perf audit 2026-09-22, #9).
let lastPosted: string | null = null;

export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    // Off the first-screen critical path: a permission dialog over a loading
    // Home, plus two network calls, can wait until the screen has settled.
    await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => resolve()));
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    const who = await session.get();
    const key = `${token}|${who?.schoolHost ?? ''}|${who?.displayName ?? ''}`;
    if (key === lastPosted) return;
    lastPosted = key;
    await api.request('/me/push-token', {
      method: 'POST',
      body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
  } catch {
    // best-effort — push must never break the app
  }
}
