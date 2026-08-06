import { Pressable, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '@/theme/theme-context';

/**
 * The slice of `@react-navigation/bottom-tabs`' `BottomTabBarProps` this bar
 * actually reads. Declared locally rather than imported: that package is a
 * transitive dependency of expo-router (not a direct one), so it isn't
 * reliably resolvable for a type-only import under pnpm — and typing only
 * what we use keeps the mock in the test small. expo-router hands the real,
 * fuller object to `tabBar={props => …}` at runtime.
 */
interface TabBarNavState {
  index: number;
  routes: { key: string; name: string }[];
}
interface TabBarNavigation {
  navigate: (name: string) => void;
  emit: (event: { type: 'tabPress'; target?: string; canPreventDefault?: boolean }) => {
    defaultPrevented?: boolean;
  };
}
interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** One visible tab — the shape of staff-nav's / family-nav's `VISIBLE_TABS` entries. */
export interface TabSpec {
  name: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

/**
 * Custom portal tab bar (pitch: Phone 3), shared by the staff and family
 * portals — see `StaffTabBar` / `FamilyTabBar` for the thin per-portal
 * wrappers that supply `tabs`. Four core tabs with a central round chevron
 * four tabs of equal width. The tools FAB that used to sit between the middle
 * pair is gone: it opened a drawer, and the drawer's tools now live on Home.
 * Removing it also gave every tab an equal share of the bar — the two either
 * side of the FAB had been squeezed toward the edges. See `_layout.tsx` for the
 * chevron while the sheet is up.
 *
 * Driven off `tabs` (not `state.routes`) so the four labelled tabs render in
 * a fixed order regardless of how expo-router registers the hidden
 * (drawer-reachable) routes; `state` is only read to decide which tab is
 * focused and to look up each route's key for `tabPress`.
 */
export type PortalTabBarProps = {
  tabs: readonly TabSpec[];
  state: TabBarNavState;
  navigation: TabBarNavigation;
  insets: EdgeInsets;
};

function TabButton({
  name,
  title,
  icon,
  focused,
  onPress,
}: {
  name: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  focused: boolean;
  onPress: () => void;
}) {
  const tokens = useTokens();
  const color = focused ? tokens.color.indigo : tokens.color.sub;
  return (
    <Pressable
      testID={`tab-${name}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={title}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 6 }}
    >
      <Ionicons name={icon} size={22} color={color} />
      {/* Capped: this label lives under an icon in a fixed-height bar. Content
          elsewhere scales freely — see theme/__tests__/text-scaling.test.ts. */}
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 10, fontWeight: '700', color }}>
        {title}
      </Text>
    </Pressable>
  );
}

export function PortalTabBar({ tabs, state, navigation, insets }: PortalTabBarProps) {
  const tokens = useTokens();
  const activeName = state.routes[state.index]?.name;


  function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    const isFocused = activeName === name;
    const event = navigation.emit({ type: 'tabPress', target: route?.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(name);
    }
  }


  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        backgroundColor: tokens.color.surface,
        borderTopColor: tokens.color.line,
        borderTopWidth: 1,
        paddingHorizontal: 8,
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      {tabs.map((t) => (
        <TabButton
          key={t.name}
          name={t.name}
          title={t.title}
          icon={t.icon}
          focused={activeName === t.name}
          onPress={() => go(t.name)}
        />
      ))}


    </View>
  );
}
