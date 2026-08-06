import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { registerForPush } from '@/lib/push';
import { FamilyTabBar, type FamilyTabBarProps } from '@/components/FamilyTabBar';
import { FamilyToolsDrawer } from '@/components/FamilyToolsDrawer';
import { VISIBLE_TABS, HIDDEN_ROUTES } from '@/lib/family-nav';

export default function FamilyTabs() {
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => { void registerForPush(); }, []);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
      // Every detail screen here is a HIDDEN TAB, not a pushed stack screen, so
      // there is no stack for back to pop. "history" makes the hardware back
      // button retrace the route actually taken — Home, Attendance, Take, then
      // back out the same way — instead of closing the app mid-register.
      backBehavior="history"
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <FamilyTabBar
            state={props.state}
            // react-navigation types `emit`'s `canPreventDefault` as the
            // literal `true`; our narrowed local nav type accepts `boolean`.
            // Runtime shape is identical — cast bridges the variance only.
            navigation={props.navigation as unknown as FamilyTabBarProps['navigation']}
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
      <FamilyToolsDrawer open={toolsOpen} onClose={() => setToolsOpen(false)} />
    </View>
  );
}
