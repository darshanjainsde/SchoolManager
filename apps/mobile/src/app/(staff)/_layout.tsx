import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { tokens } from '@/theme/tokens';
import { registerForPush } from '@/lib/push';

export default function StaffTabs() {
  useEffect(() => { void registerForPush(); }, []);
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: tokens.color.indigo }}>
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Tabs.Screen name="post" options={{ title: 'Post' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
      <Tabs.Screen name="holidays" options={{ href: null }} />
    </Tabs>
  );
}
