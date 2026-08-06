import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { registerForPush } from '@/lib/push';

/**
 * A MESSAGE THREAD IS A PLACE YOU GO, NOT A TAB YOU SWITCH TO.
 *
 * Same change as the staff portal: messages/[threadId], the diary, notices,
 * assignments, the shelf and the rest were hidden Tabs.Screen entries
 * (`href: null`), so the hardware back button had no stack to pop and closed
 * the app instead of walking home. They are stack screens now — back pops, the
 * edge-swipe gesture works, and screens slide in rather than appearing.
 *
 * Route paths are unchanged: `(tabs)` is a group, so it is transparent in the
 * URL and every existing `router.push('/(family)/messages/…')` still resolves.
 */
export const unstable_settings = {
  // A push notification can land someone straight on a thread with no history
  // behind it. Anchoring the stack means back still walks them into the app.
  initialRouteName: '(tabs)',
};

export default function FamilyLayout() {
  useEffect(() => { void registerForPush(); }, []);

  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
