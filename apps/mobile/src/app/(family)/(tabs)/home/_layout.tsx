import { Stack } from 'expo-router';

/**
 * THE STACK INSIDE THE FAMILY HOME TAB — the family twin of
 * `(staff)/(tabs)/home/_layout.tsx` (pitch №5, the frozen bar): every tool
 * opened from Home pushes within this tab, so the bottom bar stays on screen
 * and each screen keeps a real back-stack. The family portal has no
 * committing carve-out — nothing here loses work to a stray tab tap.
 */
export default function FamilyHomeStackLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
