import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { tokens } from '@/theme/tokens';
import { registerForPush } from '@/lib/push';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IoniconName) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} size={size} color={color} />;

export default function StaffTabs() {
  useEffect(() => { void registerForPush(); }, []);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.color.indigo,
        tabBarInactiveTintColor: tokens.color.sub,
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Today', tabBarIcon: icon('today-outline') }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: icon('checkbox-outline') }} />
      <Tabs.Screen name="post" options={{ title: 'Post', tabBarIcon: icon('megaphone-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }} />
      {/* Detail/utility routes — reachable via navigation, hidden from the tab bar. */}
      <Tabs.Screen name="holidays" options={{ href: null }} />
      <Tabs.Screen name="take/[classSectionId]" options={{ href: null }} />
    </Tabs>
  );
}
