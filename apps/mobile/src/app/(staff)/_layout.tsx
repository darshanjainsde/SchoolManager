import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { registerForPush } from '@/lib/push';

/**
 * A REGISTER IS A PLACE YOU GO, NOT A TAB YOU SWITCH TO.
 *
 * Every detail screen — take/[classSectionId], results/[examId],
 * messages/[threadId], notes/[classSectionId] and the drawer tools — used to be
 * declared as a hidden Tabs.Screen (`href: null`). A tab navigator keeps no
 * back stack, which cost three things at once: the hardware back button had
 * nothing to pop and closed the app from the middle of taking a register, the
 * Android edge-swipe and iOS swipe-from-left did nothing, and screens appeared
 * instantly instead of sliding in — which is most of why the app felt flatter
 * than it looked.
 *
 * They are stack screens now. Back pops, the gesture works, and the tab bar
 * correctly disappears while you are inside a register.
 *
 * Route paths are unchanged: `(tabs)` is a group, so it is transparent in the
 * URL and every existing `router.push('/(staff)/take/…')` still resolves.
 */
export const unstable_settings = {
  // A push notification can land someone straight on a detail screen with no
  // history behind it. Anchoring the stack means back still walks them into the
  // app instead of straight back out of it.
  initialRouteName: '(tabs)',
};

export default function StaffLayout() {
  useEffect(() => { void registerForPush(); }, []);

  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
