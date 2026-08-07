import { Stack } from 'expo-router';

/**
 * The family twin of `(staff)/(tabs)/profile/_layout.tsx` (pitch №7): the
 * profile's doors push within the tab — bar stays, back chip included.
 */
export default function FamilyProfileStackLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
