import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '@/theme/theme-context';
import { registerForPush } from '@/lib/push';
import { VISIBLE_TABS, HIDDEN_ROUTES } from '@/lib/staff-nav';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IoniconName) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} size={size} color={color} />;

export default function StaffTabs() {
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
      {VISIBLE_TABS.map(({ name, title, icon: iconName }) => (
        <Tabs.Screen key={name} name={name} options={{ title, tabBarIcon: icon(iconName) }} />
      ))}
      {HIDDEN_ROUTES.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
