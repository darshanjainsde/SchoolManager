import { LayoutAnimation, Pressable, Text, View } from 'react-native';
import { Icon, type IconName } from './icons';
import { useTheme, useTokens } from '@/theme/theme-context';
import { useKeyboardVisible } from '@/lib/keyboard';
import { CONTENT_MAX } from '@/theme/tokens';

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
  const { scheme } = useTheme();
  // On the dark bar the open tab must stand out whatever the accent: its pale
  // tint with deep ink in light, the bright accent with dark ink in dark (a
  // navy pill on a near-navy bar vanished — 9 Oct 2026).
  const activeBg = scheme === 'dark' ? tokens.color.indigo : tokens.color.indigo50;
  const activeInk = scheme === 'dark' ? tokens.color.onBrand : tokens.color.indigoDeep;
  // sckools-ui-standards §4 — the FLOATING PILL. The open tab is a 48 dp
  // brand pill holding its icon AND its word; the others are icons only, so
  // the bar is calm but a parent who reads little English still sees where
  // they are. Every tab keeps its title as the accessibility label.
  const color = focused ? activeInk : tokens.color.barInactive;
  return (
    <Pressable
      testID={`tab-${name}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={title}
      onPress={onPress}
      style={{ flexGrow: focused ? 1.9 : 1, flexBasis: 0, minWidth: 0, height: 48 }}
    >
      <View
        testID={focused ? `tab-indicator-${name}` : undefined}
        style={{
          flex: 1,
          borderRadius: 24,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingHorizontal: 8,
          backgroundColor: focused ? activeBg : 'transparent',
        }}
      >
        <Icon name={icon} size={22} color={color} fillOpacity={focused ? 0.3 : 0.14} />
        {focused ? (
          // Capped: this label lives in a fixed-height bar. Content elsewhere
          // scales freely — see theme/__tests__/text-scaling.test.ts.
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={tight ? 1.15 : 1.3}
            style={{ fontSize: tight ? 12.5 : 13, fontWeight: '600', color, flexShrink: 1 }}
          >
            {title}
          </Text>
        ) : null}
      </View>
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
      // The open pill widens to its new home instead of jumping.
      LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'scaleXY'));
      navigation.navigate(name);
    }
  }

  if (typing) return null;

  // The bar sits IN FLOW on the page ground, so no screen has to pad for it
  // and nothing can scroll under it; the pill inside floats 16 dp in from each
  // edge and 12 dp above the system bar (sckools-ui-standards §4).
  return (
    <View
      style={{
        backgroundColor: tokens.color.appBg,
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: insets.bottom + 12,
      }}
    >
      <View
        testID="tab-bar-pill"
        style={{
          // Same column as the content on wide screens (CONTENT_MAX - 2 × 16).
          width: '100%',
          maxWidth: CONTENT_MAX - 32,
          alignSelf: 'center',
          height: 64,
          borderRadius: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          padding: 8,
          backgroundColor: tokens.color.barBg,
          borderWidth: tokens.color.barBg === tokens.color.surface ? 1 : 0,
          borderColor: tokens.color.line,
          shadowColor: tokens.color.ink,
          shadowOpacity: 0.18,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
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
    </View>
  );
}
