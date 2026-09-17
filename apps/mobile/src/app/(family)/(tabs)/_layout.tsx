import { Tabs } from 'expo-router';
import { FamilyTabBar, type FamilyTabBarProps } from '@/components/FamilyTabBar';
import { ALL_TABS, visibleTabs } from '@/lib/family-nav';
import { useSession } from '@/lib/use-session';

/**
 * THE PLACES A FAMILY LIVES — four, or five with fees. Everything else pushes
 * on top of this from the parent Stack — see the note in ../_layout.tsx for
 * why detail screens stopped being hidden tabs.
 *
 * Every tab file is registered so a deep link resolves; the BAR draws only
 * what this school has switched on (second edition — the feature list rides
 * on the session). `backBehavior="history"` still governs moving BETWEEN
 * tabs, which no stack is involved in.
 */
export default function FamilyTabsLayout() {
  const s = useSession();
  const tabs = visibleTabs(s?.features);
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
          tabs={tabs}
        />
      )}
    >
      {ALL_TABS.map(({ name, title }) => (
        <Tabs.Screen key={name} name={name} options={{ title }} />
      ))}
    </Tabs>
  );
}
