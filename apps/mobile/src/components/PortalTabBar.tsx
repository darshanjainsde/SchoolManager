import { Pressable, Text, View } from 'react-native';
import { Icon, type IconName } from './icons';
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

/** One visible tab — the shape of staff-nav's / family-nav's tab entries. */
export interface TabSpec {
  name: string;
  title: string;
  /** A duotone glyph from components/icons.tsx — the same set the tool domes draw. */
  icon: IconName;
}

/**
 * Custom portal tab bar (pitch: Phone 3), shared by the staff and family
 * portals — see `StaffTabBar` / `FamilyTabBar` for the thin per-portal
 * wrappers that supply `tabs`. Every tab gets an equal share of the bar.
 *
 * SECOND EDITION: the bar draws the app's own duotone glyphs. It drew
 * Ionicons until now — a second icon language two inches under the domes,
 * and the only runtime font the app loaded, which is the asset that failed
 * on a real Android 14 handset and left a family looking at boxes.
 *
 * Driven off `tabs` (not `state.routes`) so the labelled tabs render in a
 * fixed order regardless of how expo-router registers the hidden routes;
 * `state` is only read to decide which tab is focused and to look up each
 * route's key for `tabPress`.
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
  icon: IconName;
  focused: boolean;
  onPress: () => void;
}) {
  const tokens = useTokens();
  // On the dark bar the accent system stays out (a school's maroon on ink
  // would be mud): active = near-white, and the amber indicator above the
  // icon is what says "you are here".
  const color = focused ? tokens.color.barActive : tokens.color.barInactive;
  return (
    <Pressable
      testID={`tab-${name}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={title}
      onPress={onPress}
      style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 6 }}
    >
      <View
        testID={focused ? `tab-indicator-${name}` : undefined}
        style={{
          position: 'absolute',
          top: 0,
          width: 26,
          height: 3,
          borderRadius: 3,
          backgroundColor: focused ? tokens.color.barIndicator : 'transparent',
        }}
      />
      {/* The focused glyph fills a little more, the way the live dome does. */}
      <Icon name={icon} size={22} color={color} fillOpacity={focused ? 0.34 : 0.18} />
      {/* Capped: this label lives under an icon in a fixed-height bar. Content
          elsewhere scales freely — see theme/__tests__/text-scaling.test.ts. */}
      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 10, fontWeight: '700', color }}>
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
        // THE BAR IS THE THEME'S DARK FORM in both schemes — chrome, not
        // another card on the paper (see tokens.ts barBg note).
        backgroundColor: tokens.color.barBg,
        borderTopColor: tokens.color.barBg,
        borderTopWidth: 1,
        paddingHorizontal: 4,
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
