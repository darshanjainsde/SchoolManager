import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Icon } from '@/components/icons';
import { useTokens } from '@/theme/theme-context';
import { registerForPush } from '@/lib/push';

/**
 * The non-teaching STAFF portal — deliberately one tab. "currently minimal"
 * per the Phase 4 Task 3 brief: own attendance only, plus an honest note
 * that leave-apply isn't built yet (LeaveApplication has no staffId path —
 * see today.tsx's comment). Mirrors the web's /staff (single "Home" tab,
 * same shell shape as (family)/(staff) here).
 *
 * NOT the same group as (staff) — that folder is actually the TEACHER +
 * SCHOOL_ADMIN portal (a legacy, slightly misleading name); STAFF used to
 * be routed there too, which is exactly the "wrong portal" gap this group
 * closes. See apps/mobile/src/lib/roles.ts's portalForRole.
 */
export default function WorkerTabs() {
  const tokens = useTokens();
  useEffect(() => { void registerForPush(); }, []);
  return (
    <Tabs
      // Every detail screen here is a HIDDEN TAB, not a pushed stack screen, so
      // there is no stack for back to pop. "history" makes the hardware back
      // button retrace the route actually taken — Home, Attendance, Take, then
      // back out the same way — instead of closing the app mid-register.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.color.indigo,
        tabBarInactiveTintColor: tokens.color.sub,
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Icon name="home" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
