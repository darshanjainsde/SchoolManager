import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '@/theme/theme-context';
import { registerForPush } from '@/lib/push';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IoniconName) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} size={size} color={color} />;

export default function FamilyTabs() {
  const tokens = useTokens();
  useEffect(() => { void registerForPush(); }, []);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.color.indigo,
        tabBarInactiveTintColor: tokens.color.sub,
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: icon('checkbox-outline') }} />
      <Tabs.Screen name="notices" options={{ title: 'Notices', tabBarIcon: icon('notifications-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }} />
      <Tabs.Screen name="holidays" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="timetable" options={{ href: null }} />
      <Tabs.Screen name="results" options={{ href: null }} />
      <Tabs.Screen name="assignments" options={{ href: null }} />
      <Tabs.Screen name="messages" options={{ href: null }} />
      <Tabs.Screen name="messages/[threadId]" options={{ href: null }} />
    </Tabs>
  );
}
