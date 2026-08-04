import { Animated, Pressable, Text, View } from 'react-native';
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
 * FAB between the middle pair that lifts the tools drawer
 * (`PortalToolsDrawer`). There is no "More" tab: each portal's `_layout.tsx`
 * owns the drawer's open state and passes it down so the FAB can rotate its
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
  onToolsPress: () => void;
  toolsOpen: boolean;
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
      <Text style={{ fontSize: 10, fontWeight: '700', color }}>{title}</Text>
    </Pressable>
  );
}

export function PortalTabBar({ tabs, state, navigation, insets, onToolsPress, toolsOpen }: PortalTabBarProps) {
  const tokens = useTokens();
  const activeName = state.routes[state.index]?.name;

  // Chevron rotates 180° (points down) while the drawer is open — mirrors the
  // pitch's `.handle .chev { transform: rotate(180deg) }`.
  const spin = useRef(new Animated.Value(toolsOpen ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(spin, { toValue: toolsOpen ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [toolsOpen, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    const isFocused = activeName === name;
    const event = navigation.emit({ type: 'tabPress', target: route?.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(name);
    }
  }

  // FAB sits between the middle pair: [tab0] [tab1] (FAB) [tab2] [tab3].
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

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
      {left.map((t) => (
        <TabButton
          key={t.name}
          name={t.name}
          title={t.title}
          icon={t.icon}
          focused={activeName === t.name}
          onPress={() => go(t.name)}
        />
      ))}

      <View style={{ width: 56, alignItems: 'center' }}>
        <Pressable
          testID="tools-fab"
          accessibilityRole="button"
          accessibilityLabel={toolsOpen ? 'Close tools' : 'Open tools'}
          accessibilityState={{ expanded: toolsOpen }}
          onPress={onToolsPress}
          style={({ pressed }) => ({
            width: 52,
            height: 52,
            marginTop: -22,
            borderRadius: 26,
            backgroundColor: tokens.color.indigo,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.94 : 1 }],
            shadowColor: tokens.color.indigo,
            shadowOpacity: 0.5,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          })}
        >
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name="chevron-up" size={24} color={tokens.color.onBrand} />
          </Animated.View>
        </Pressable>
        <Text style={{ fontSize: 10, fontWeight: '700', color: tokens.color.sub, marginTop: 2 }}>Tools</Text>
      </View>

      {right.map((t) => (
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
