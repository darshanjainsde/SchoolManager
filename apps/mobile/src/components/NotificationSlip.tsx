import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NotificationRow } from '@skoolos/types';
import { ApiError } from '@/lib/api';
import { fetchNotifications, markNotificationsRead } from '@/lib/notifications';
import { KIND_ICON, formatWhen, routeFor, type NotificationGroup } from '@/lib/notification-links';
import { Empty } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, play, useReduceMotion } from '@/theme/motion';

/**
 * The scrim tint from the pitch (`rgba(23,20,50,.35)`) — the ink colour at
 * 35%, not a neutral black. It is deliberately the same in both colour
 * schemes: it is not a surface, it is the page being pushed back, and paper
 * pushed back reads the same whatever the light in the room.
 */
const SCRIM = 'rgba(23,20,50,0.35)';

export interface NotificationSlipProps {
  /** Decides where a tapped row deep-links — see `lib/notification-links.ts`. */
  group: NotificationGroup;
  visible: boolean;
  onClose: () => void;
  /** Reports the remaining unread count so the bell's badge can count down. */
  onUnreadChange?: (count: number) => void;
}

/**
 * THE PIN, in its "slip" variant. The pitch's `.ntsheet` starts at
 * `translateY(-14px) scale(.97)` and transparent, and settles over .28s: a
 * piece of paper coming down out from under the bell and forward onto the
 * page. It is the Pin rather than a generic sheet-slide because what arrives
 * is an ITEM landing on the page you were already reading — the screen behind
 * never goes anywhere, which is the whole point of not navigating.
 *
 * Replays on every open (not `useGesture`, which fires once for good): each
 * opening is a fresh slip being pulled out, not one thing that happened once.
 */
function useSlipEntrance(visible: boolean): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReduceMotion();
  useEffect(() => {
    if (!visible) return;
    v.setValue(0);
    play(v, DUR.slip, { reduced: reduced.current, native: true });
  }, [visible, v, reduced]);
  return v;
}

/** One `.ntitem` row: a 30px icon tile, title, meta, and an unread dot. */
function SlipItem({
  n,
  onPress,
  first,
}: {
  n: NotificationRow;
  onPress: () => void;
  first: boolean;
}) {
  const tokens = useTokens();
  const unread = !n.readAt;
  // `.ntitem.remk` — a diary remark reads in red ink everywhere in this
  // product (it is the one notification a family owes an answer to), so its
  // icon tile takes the red wash instead of the neutral paper-dim one.
  const isRemark = n.kind === 'DIARY';
  return (
    <Pressable
      testID={`notification-slip-${n.id}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
        // `.ntitem.rd` — a read row stays legible but stops competing.
        opacity: unread ? 1 : 0.55,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isRemark ? tokens.color.red50 : tokens.color.surfaceMuted,
        }}
      >
        <Text style={{ fontSize: 14 }}>{KIND_ICON[n.kind] ?? '🔔'}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingRight: unread ? 12 : 0 }}>
        {/* 11.5px / 650 in the pitch; RN only accepts the 100-900 ladder, so
            every 650 in this file lands on '600'. */}
        <Text style={{ fontSize: 11.5, fontWeight: '600', lineHeight: 15.5, color: tokens.color.ink }}>
          {n.title}
        </Text>
        <Text style={{ fontSize: 9.5, color: tokens.color.sub, marginTop: 1 }} numberOfLines={2}>
          {n.body ? `${n.body} · ${formatWhen(n.createdAt)}` : formatWhen(n.createdAt)}
        </Text>
      </View>
      {unread && (
        <View
          style={{
            position: 'absolute',
            right: 12,
            top: 14,
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: tokens.color.indigo,
          }}
        />
      )}
    </Pressable>
  );
}

/**
 * The bell's own surface: a slip of paper that unfolds downward IN PLACE over
 * the current screen, rather than a screen you navigate to.
 *
 * Why in place: a notification is a note about the page you are on, not a
 * destination. Navigating away to read one costs the reader their place and
 * then makes them find their way back — the pitch's whole argument for the
 * slip. The standalone `NotificationsScreen` still exists as the full-page
 * archive (reachable from "See all notifications" below, and the landing
 * route for a tapped push), so nothing was taken away, only made cheaper.
 *
 * Reads apply OPTIMISTICALLY (same contract as the screen): the row dims and
 * the badge counts down immediately, the server call is fire-and-forget, and
 * a failure simply leaves the row unread at the next fetch.
 */
export function NotificationSlip({ group, visible, onClose, onUnreadChange }: NotificationSlipProps) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entrance = useSlipEntrance(visible);

  // Fetched per OPENING, not once per mount: the slip is a snapshot of "what
  // has happened", and a stale snapshot is worse than a moment of "Loading…".
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError(null);
    fetchNotifications()
      .then((r) => {
        if (cancelled) return;
        setRows(r.notifications);
        onUnreadChange?.(r.notifications.filter((n) => !n.readAt).length);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      });
    return () => {
      cancelled = true;
    };
    // `onUnreadChange` is the bell's setState — deliberately not a dependency,
    // or an inline arrow at the call site would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const markAll = () => {
    const now = new Date().toISOString();
    setRows((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? now })) ?? prev);
    onUnreadChange?.(0);
    markNotificationsRead().catch(() => {});
  };

  const open = (n: NotificationRow) => {
    if (!n.readAt) {
      const now = new Date().toISOString();
      const remaining = (rows ?? []).filter((x) => !x.readAt && x.id !== n.id).length;
      setRows((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: now } : x)) ?? prev);
      onUnreadChange?.(remaining);
      markNotificationsRead([n.id]).catch(() => {});
    }
    const route = routeFor(group, n);
    onClose();
    if (route) router.push(route);
  };

  const seeAll = () => {
    onClose();
    router.push(`/${group}/notifications`);
  };

  const unread = (rows ?? []).filter((n) => !n.readAt);
  const earlier = (rows ?? []).filter((n) => n.readAt);

  return (
    <Modal
      transparent
      visible={visible}
      // The scrim's own .25s dim and the slip's .28s settle are close enough
      // that RN's built-in cross-fade covers both directions without this
      // component having to own an exit animation it could get stuck inside.
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        testID="notification-slip-scrim"
        accessibilityLabel="Close notifications"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: SCRIM }}
      />
      <Animated.View
        testID="notification-slip"
        style={{
          position: 'absolute',
          left: 8,
          right: 8,
          // The pitch pins the slip 6px below the status bar (top:36 under a
          // 30px status bar), so it hangs directly off the bell's own row.
          top: insets.top + 6,
          maxHeight: '74%',
          backgroundColor: tokens.color.surface,
          borderWidth: 1,
          borderColor: tokens.color.line,
          borderRadius: 16,
          overflow: 'hidden',
          shadowColor: tokens.color.ink,
          shadowOpacity: 0.5,
          shadowRadius: 50,
          shadowOffset: { width: 0, height: 24 },
          elevation: 14,
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
            { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
          ],
        }}
      >
        <ScrollView testID="notification-slip-scroll" showsVerticalScrollIndicator={false}>
          {/* `.nthead` */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 12,
              paddingHorizontal: 14,
              paddingBottom: 8,
            }}
          >
            <Text style={{ fontFamily: font.serif, fontWeight: '600', fontSize: 14, color: tokens.color.ink }}>
              Notifications
            </Text>
            {unread.length > 0 && (
              <Pressable testID="notification-slip-mark-all" onPress={markAll} hitSlop={8}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: tokens.color.indigo }}>
                  Mark all read
                </Text>
              </Pressable>
            )}
          </View>

          {error && (
            <Text
              testID="notification-slip-error"
              style={{ paddingHorizontal: 14, paddingBottom: 12, fontSize: 11.5, color: tokens.color.red }}
            >
              {error}
            </Text>
          )}
          {rows === null && !error && (
            <Text style={{ paddingHorizontal: 14, paddingBottom: 12, fontSize: 11.5, color: tokens.color.sub }}>
              Loading…
            </Text>
          )}
          {rows?.length === 0 && !error && (
            // `.empty` — the pitch sets every empty state in the serif italic,
            // so an empty slip still reads as a page and not as a failure.
            <Empty testID="notification-slip-empty">All caught up. 🎉</Empty>
          )}

          {unread.length > 0 && <SectionLabel>New</SectionLabel>}
          {unread.map((n, i) => (
            <SlipItem key={n.id} n={n} first={i === 0} onPress={() => open(n)} />
          ))}
          {earlier.length > 0 && <SectionLabel>Earlier</SectionLabel>}
          {earlier.map((n, i) => (
            <SlipItem key={n.id} n={n} first={i === 0} onPress={() => open(n)} />
          ))}

          {rows !== null && rows.length > 0 && (
            <Pressable
              testID="notification-slip-see-all"
              onPress={seeAll}
              style={{
                paddingVertical: 11,
                paddingHorizontal: 14,
                borderTopWidth: 1,
                borderTopColor: tokens.color.line,
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', color: tokens.color.indigo }}>
                See all notifications ›
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

/** `.ntsec` — the uppercase paper-tab label dividing New from Earlier. */
function SectionLabel({ children }: { children: string }) {
  const tokens = useTokens();
  return (
    <Text
      style={{
        fontSize: 9,
        fontWeight: '800',
        letterSpacing: 0.9,
        textTransform: 'uppercase',
        color: tokens.color.sub,
        paddingTop: 6,
        paddingHorizontal: 14,
        paddingBottom: 2,
      }}
    >
      {children}
    </Text>
  );
}
