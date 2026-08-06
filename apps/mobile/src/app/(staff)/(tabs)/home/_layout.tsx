import { Stack } from 'expo-router';

/**
 * THE STACK INSIDE THE HOME TAB (pitch №5 — the frozen bar, done the sound
 * way). Every tool a teacher opens from Home pushes WITHIN this tab, so the
 * bottom bar stays on screen AND each screen keeps a real back-stack — unlike
 * the old hidden-tab arrangement this app once had, where detail screens
 * lived as `href: null` tabs and back didn't work (see the note in
 * `(staff)/_layout.tsx`).
 *
 * The ONE deliberate absentee is `take/[classSectionId]`: mid-register, a
 * stray thumb on an always-there bar would throw away a class's unsaved
 * marks, so taking attendance stays a full-screen push on the parent Stack.
 */
export default function StaffHomeStackLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
