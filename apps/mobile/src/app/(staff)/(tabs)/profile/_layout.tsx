import { Stack } from 'expo-router';

/**
 * THE STACK INSIDE THE PROFILE TAB (pitch №7 — the profile's doors, same
 * architecture as `(tabs)/home/_layout.tsx`): Appearance and Change
 * password push WITHIN the tab, so the bottom bar stays on screen and each
 * door keeps a real back-stack with its chip header.
 */
export default function StaffProfileStackLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
