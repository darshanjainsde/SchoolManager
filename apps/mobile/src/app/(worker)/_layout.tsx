import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { registerForPush } from '@/lib/push';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

/**
 * The non-teaching STAFF portal — office, support, driver, helper, security,
 * and (until their own desks ship) the librarian and the sports teacher.
 *
 * NOT the same group as (staff), which is the TEACHER + SCHOOL_ADMIN portal
 * (a legacy, slightly misleading name). Shaped exactly like the other two
 * portals: a Stack here, a Tabs group inside it, and a stack per tab — which
 * is what gives every pushed screen its back chip for free.
 */
export default function WorkerLayout() {
  useEffect(() => { void registerForPush(); }, []);
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
