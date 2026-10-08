import { Pressable, Text, View } from 'react-native';
import { Icon, type IconName } from './icons';
import { useTokens } from '@/theme/theme-context';
import { useKeyboardVisible } from '@/lib/keyboard';

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
  tight = false,
}: {
  name: string;
  title: string;
  icon: IconName;
  focused: boolean;
  onPress: () => void;
  /** Five tabs on a narrow phone: tighten the label rather than clip the word. */
  tight?: boolean;
}) {
  const tokens = useTokens();
  // UI v2: a light bar; the selected tab is the school colour on its own tint.
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
      {/* UI v2: the Material 3 selected PILL behind the icon (a tint of the
          school colour), instead of a 3 dp line above it — a target a thumb
          can see, on a light bar. */}
      <View
        testID={focused ? `tab-indicator-${name}` : undefined}
        style={{
          width: 56,
          height: 30,
          borderRadius: 15,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: focused ? tokens.color.barIndicator : 'transparent',
        }}
      >
        <Icon name={icon} size={22} color={color} fillOpacity={focused ? 0.3 : 0.14} />
      </View>
      {/* Capped: this label lives under an icon in a fixed-height bar. Content
          elsewhere scales freely — see theme/__tests__/text-scaling.test.ts. */}
      <Text
            numberOfLines={1}
            // Five tabs on a 360 dp phone give each ~70 dp; "Attendance" at 10px
            // and the 1.3 cap needed ~74 and rendered as "Attendanc…". The
            // fifth tab tightens the type instead of clipping the word
            // (UI audit 2026-09-22, #23).
            maxFontSizeMultiplier={tight ? 1.15 : 1.3}
            style={{ fontSize: tight ? 10.5 : 11.5, fontWeight: focused ? '700' : '500', color }}
          >
        {title}
      </Text>
    </Pressable>
  );
}

export function PortalTabBar({ tabs, state, navigation, insets }: PortalTabBarProps) {
  const tokens = useTokens();
  const activeName = state.routes[state.index]?.name;
  // The bar steps aside while someone types: it would otherwise ride on top
  // of the keyboard and take 64 dp from the box being typed into.
  const typing = useKeyboardVisible();

  function go(name: string) {
    const route = state.routes.find((r) => r.name === name);
    const isFocused = activeName === name;
    const event = navigation.emit({ type: 'tabPress', target: route?.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(name);
    }
  }

  if (typing) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        // THE BAR IS THE THEME'S DARK FORM in both schemes — chrome, not
        // another card on the paper (see tokens.ts barBg note).
        backgroundColor: tokens.color.barBg,
        borderTopColor: tokens.color.line,
        borderTopWidth: 1,
        paddingHorizontal: 4,
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      {tabs.map((t) => (
        <TabButton
          tight={tabs.length > 4}
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
