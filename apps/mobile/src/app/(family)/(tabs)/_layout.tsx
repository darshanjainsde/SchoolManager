import { Tabs } from 'expo-router';
import { FamilyTabBar, type FamilyTabBarProps } from '@/components/FamilyTabBar';
import { VISIBLE_TABS } from '@/lib/family-nav';

/**
 * THE FOUR PLACES A FAMILY LIVES. Everything else pushes on top of this from
 * the parent Stack — see the note in ../_layout.tsx for why detail screens
 * stopped being hidden tabs.
 *
 * `backBehavior="history"` still governs moving BETWEEN tabs, which no stack
 * is involved in.
 */
export default function FamilyTabsLayout() {

  return (
    <Tabs
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
          />
        )}
      >
        {VISIBLE_TABS.map(({ name, title }) => (
          <Tabs.Screen key={name} name={name} options={{ title }} />
        ))}
    </Tabs>
  );
}
