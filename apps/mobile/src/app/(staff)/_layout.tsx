import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { registerForPush } from '@/lib/push';
import { StaffTabBar, type StaffTabBarProps } from '@/components/StaffTabBar';
import { ToolsDrawer } from '@/components/ToolsDrawer';
import { VISIBLE_TABS, HIDDEN_ROUTES } from '@/lib/staff-nav';

export default function StaffTabs() {
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => { void registerForPush(); }, []);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <StaffTabBar
            state={props.state}
            // react-navigation types `emit`'s `canPreventDefault` as the
            // literal `true`; our narrowed local nav type accepts `boolean`.
            // Runtime shape is identical — cast bridges the variance only.
            navigation={props.navigation as unknown as StaffTabBarProps['navigation']}
            insets={props.insets}
            toolsOpen={toolsOpen}
            onToolsPress={() => setToolsOpen((o) => !o)}
          />
        )}
      >
        {VISIBLE_TABS.map(({ name, title }) => (
          <Tabs.Screen key={name} name={name} options={{ title }} />
        ))}
        {HIDDEN_ROUTES.map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
      </Tabs>

      {/* Overlay above the tab bar; renders nothing while closed. */}
      <ToolsDrawer open={toolsOpen} onClose={() => setToolsOpen(false)} />
    </View>
  );
}
