import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { UnreadCountResult } from '@skoolos/types';
import { api } from '@/lib/api';
import { signOut } from '@/lib/sign-out';
import type { MoreTone } from '@/lib/staff-nav';
import { useTokens } from '@/theme/theme-context';
import { brand } from '@/theme/tokens';

/**
 * One drawer tile — the shape shared by staff-nav's and family-nav's
 * `MORE_ITEMS` entries (their `route` unions both extend `string`).
 */
export interface DrawerItem {
  label: string;
  icon: string;
  route: string;
  tone?: MoreTone;
}

function toneTile(tokens: ReturnType<typeof useTokens>, tone: MoreTone | undefined) {
  switch (tone) {
    case 'amber':
      return { bg: tokens.color.amber50, fg: tokens.color.late };
    case 'green':
      return { bg: tokens.color.green50, fg: tokens.color.green };
    default:
      return { bg: tokens.color.indigo50, fg: tokens.color.indigo };
  }
}

function ToolTile({ item, badge, onPress }: { item: DrawerItem; badge?: number; onPress: () => void }) {
  const tokens = useTokens();
  const tile = toneTile(tokens, item.tone);
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <Pressable
      testID={`tool-${item.label}`}
      accessibilityRole="button"
      accessibilityLabel={showBadge ? `${item.label}, ${badge} new` : item.label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: '30%',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: tokens.color.surfaceMuted,
        borderColor: tokens.color.line,
        borderWidth: 1,
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 6,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor: tile.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 19 }}>{item.icon}</Text>
        {showBadge && (
          <View
            testID={`tool-badge-${item.label}`}
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 17,
              height: 17,
              borderRadius: 9,
              paddingHorizontal: 4,
              backgroundColor: tokens.color.amber,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: brand.onHero, fontSize: 10, fontWeight: '800' }}>{badge}</Text>
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.ink, textAlign: 'center' }}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

export type PortalToolsDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** The drawer grid — each portal's `MORE_ITEMS`. */
  items: readonly DrawerItem[];
  /**
   * Live tile counts: item route → count endpoint returning `{ count }`.
   * Fetched each time the drawer opens; a route without an entry never shows
   * a badge. Failures are swallowed — a badge must never surface an error, it
   * just shows nothing.
   */
  badgeEndpoints?: Readonly<Record<string, string>>;
};

/**
 * Bottom-sheet tools drawer (pitch: Phone 3), shared by the staff and family
 * portals — see `ToolsDrawer` / `FamilyToolsDrawer` for the thin per-portal
 * wrappers that supply `items` and `badgeEndpoints`. A dimming scrim + a
 * rounded sheet that slides up from the bottom over whatever tab is showing,
 * laying out every tool in a 3-column grid with live badges, plus Log out.
 * The chevron FAB in the portal's tab bar toggles `open`; the parent
 * (`_layout.tsx`) owns that state so the sheet overlays the tab bar too.
 *
 * Animation uses RN's built-in `Animated` (no new deps): a single 0→1
 * `progress` value drives the scrim opacity and the sheet's translateY
 * together. When the OS "reduce motion" setting is on, the value is set
 * instantly instead of timed — no slide, no fade.
 *
 * The overlay only mounts while it needs to be visible (open, or animating
 * out), so when closed it adds nothing to the tree and intercepts no touches
 * — it never shifts the underlying layout.
 */
export function PortalToolsDrawer({ open, onClose, items, badgeEndpoints = {} }: PortalToolsDrawerProps) {
  const tokens = useTokens();
  const [mounted, setMounted] = useState(open);
  const [sheetH, setSheetH] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const reduceMotion = useRef(false);

  // Read the OS reduce-motion preference once, then keep it live.
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) reduceMotion.current = v;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduceMotion.current = v;
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  // Fetch the live tile counts each time the drawer opens. Swallowed on
  // failure: a badge must never surface an error, it just shows nothing.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const routes = Object.keys(badgeEndpoints);
    if (routes.length === 0) return;
    Promise.all(
      routes.map((route) =>
        api
          .request<UnreadCountResult>(badgeEndpoints[route])
          .then((r) => [route, r.count] as const)
          .catch(() => [route, 0] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setCounts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mount on open; on close, animate out then unmount.
  useEffect(() => {
    if (open) {
      setMounted(true);
    } else if (mounted) {
      animateTo(0, () => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Slide in once the sheet is in the tree.
  useEffect(() => {
    if (mounted && open) animateTo(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, open]);

  function animateTo(toValue: number, done?: () => void) {
    if (reduceMotion.current) {
      progress.setValue(toValue);
      done?.();
      return;
    }
    Animated.timing(progress, { toValue, duration: 280, useNativeDriver: true }).start(({ finished }) => {
      if (finished) done?.();
    });
  }

  // Hardware back (Android) closes the sheet instead of leaving the screen —
  // the mobile equivalent of the pitch's Escape-to-close.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  if (!mounted) return null;

  const hidden = sheetH || 800; // fallback before the sheet has been measured
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [hidden, 0] });

  function openTool(item: DrawerItem) {
    router.push(item.route);
    onClose();
  }

  // Only routes with a count endpoint carry a live count; the rest have none.
  function badgeFor(item: DrawerItem): number | undefined {
    return item.route in badgeEndpoints ? (counts[item.route] ?? 0) : undefined;
  }

  async function onLogout() {
    await signOut();
    onClose();
  }

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 50 }}>
      <Pressable
        testID="tools-scrim"
        accessibilityRole="button"
        accessibilityLabel="Close tools"
        onPress={onClose}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      >
        <Animated.View
          style={{ flex: 1, backgroundColor: 'rgba(10,10,25,0.44)', opacity: progress }}
        />
      </Pressable>

      <Animated.View
        testID="tools-sheet"
        accessibilityViewIsModal
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: tokens.color.surface,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 28,
          transform: [{ translateY }],
          shadowColor: brand.hero.shadow,
          shadowOpacity: 0.4,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: -12 },
          elevation: 24,
        }}
      >
        <View
          style={{
            width: 38,
            height: 5,
            borderRadius: 3,
            backgroundColor: tokens.color.line,
            alignSelf: 'center',
            marginTop: 4,
            marginBottom: 12,
          }}
        />
        <Text style={{ fontSize: 15, fontWeight: '800', color: tokens.color.ink, marginHorizontal: 4 }}>
          All tools
        </Text>
        <Text style={{ fontSize: 12, color: tokens.color.sub, marginHorizontal: 4, marginBottom: 12 }}>
          Everything the tab bar doesn’t hold.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
          {items.map((item) => (
            <ToolTile key={item.label} item={item} badge={badgeFor(item)} onPress={() => openTool(item)} />
          ))}
        </View>

        <Pressable
          testID="tools-logout"
          accessibilityRole="button"
          onPress={onLogout}
          style={({ pressed }) => ({
            marginTop: 14,
            borderColor: tokens.color.line,
            borderWidth: 1,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: tokens.color.red, fontWeight: '700', fontSize: 13 }}>Log out</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
