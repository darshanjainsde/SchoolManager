import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { tokens } from '@/theme/tokens';
import { registerForPush } from '@/lib/push';

export default function FamilyTabs() {
  useEffect(() => { void registerForPush(); }, []);
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: tokens.color.indigo }}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Tabs.Screen name="notices" options={{ title: 'Notices' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
      <Tabs.Screen name="holidays" options={{ href: null }} />
    </Tabs>
  );
}
