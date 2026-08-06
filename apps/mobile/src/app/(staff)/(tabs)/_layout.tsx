import { useState } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { StaffTabBar, type StaffTabBarProps } from '@/components/StaffTabBar';
import { ToolsDrawer } from '@/components/ToolsDrawer';
import { VISIBLE_TABS } from '@/lib/staff-nav';

/**
 * THE FOUR PLACES A TEACHER LIVES. Everything else pushes on top of this from
 * the parent Stack, so this navigator now holds tabs and nothing but tabs —
 * detail screens used to be declared here as `href: null` tabs, which is what
 * left them with no back stack.
 *
 * `backBehavior="history"` still earns its place: it governs moving BETWEEN
 * tabs (Today, Attendance, back → Today), which no stack is involved in.
 */
export default function StaffTabsLayout() {
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        backBehavior="history"
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
      </Tabs>

      {/* Overlay above the tab bar; renders nothing while closed. Lives here
          rather than on the Stack so it cannot appear over a detail screen. */}
      <ToolsDrawer open={toolsOpen} onClose={() => setToolsOpen(false)} />
    </View>
  );
}
