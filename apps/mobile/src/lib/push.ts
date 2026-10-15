import { InteractionManager, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { session } from './session';
import { api } from './api';
import { markAllStale } from './cache-store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
    shouldShowBanner: true, shouldShowList: true,
  }),
});

/**
 * A push means somebody changed something about this person — a cover given
 * on the console, a leave decided, a result published. Whatever is on screen
 * asks the server again (keeping what it shows until the answer lands), so a
 * phone that is open never shows the old picture next to the new notice.
 */
Notifications.addNotificationReceivedListener(() => {
  markAllStale();
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
