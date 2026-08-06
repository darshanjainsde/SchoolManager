import { useCallback, useState } from 'react';
import { Pressable, Text, View, type TextStyle } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { NotificationRow } from '@skoolos/types';
import { ApiError } from '@/lib/api';
import { clearNotifications, fetchNotifications, markNotificationsRead } from '@/lib/notifications';
import { KIND_ICON, formatWhen, routeFor, type NotificationGroup } from '@/lib/notification-links';
import { Animated } from 'react-native';
import { Card, Empty, Page, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font, type ColorPalette } from '@/theme/tokens';
import { DUR, pinStyle, useGesture } from '@/theme/motion';

type Group = NotificationGroup;

/** The pitch's `.ntsec` — a tracked, uppercase divider, not a heading. */
function groupLabel(tokens: { color: ColorPalette }): TextStyle {
  return {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: tokens.color.sub,
    marginHorizontal: 4,
    marginTop: 8,
    marginBottom: 2,
  };
}

/**
 * One row, as the pitch's `.ntitem`: a rounded icon tile, the line, the meta,
 * and an unread dot out at the right edge so "what haven't I opened" reads
 * straight down one column. A read row drops to .55 — present, but plainly
 * spent.
 *
 * THE PIN, on unread rows ONLY (`index` staggers them so a batch lands as a
 * sequence rather than one flash). An unread notification is a slip that has
 * just gone up on the board; a row you have already read arriving with the
 * same flourish would be the interface lying about what is new. This mirrors
 * `NotificationSlip` exactly — the slip and this screen are two views of one
 * board, so they must not move differently.
 */
function Row({
  n,
  index,
  onPress,
  onDismiss,
}: {
  n: NotificationRow;
  index: number;
  onPress: () => void;
  /** The per-row ✕ (pitch №3): soft-clears just this row. */
  onDismiss: () => void;
}) {
  const tokens = useTokens();
  const unread = !n.readAt;
  // A remark is the one kind that carries a consequence at home, so its tile
  // is inked red — the pitch's `.ntitem.remk`.
  const isRemark = n.kind === 'DIARY';
  const pin = useGesture(unread, DUR.pin, { delay: Math.min(index, 6) * 60 });

  const row = (
    <Pressable testID={`notification-${n.id}`} onPress={onPress}>
      <Card
        style={{
          flexDirection: 'row',
          gap: 11,
          alignItems: 'flex-start',
          // Unread keeps its tint and its outline. The repaint took the
          // highlight OFF the unread row and put a .55 fade ON the read one,
          // which made "what haven't I opened" a subtler question than it was
          // and made everything already read harder to go back and read.
          backgroundColor: unread ? tokens.color.indigo50 : tokens.color.surface,
          borderColor: unread ? tokens.color.indigo : tokens.color.line,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: isRemark ? tokens.color.red50 : tokens.color.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 16 }}>{KIND_ICON[n.kind] ?? '🔔'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 13.5,
              fontFamily: font.serif,
              fontWeight: '600',
              color: isRemark ? tokens.color.red : tokens.color.ink,
            }}
          >
            {n.title}
          </Text>
          {n.body ? (
            <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 2 }} numberOfLines={2}>
              {n.body}
            </Text>
          ) : null}
          <Text style={{ fontSize: 10.5, color: tokens.color.sub, marginTop: 3, fontFamily: font.mono }}>
            {formatWhen(n.createdAt)}
          </Text>
        </View>
        {unread && (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: tokens.color.marginRed,
              marginTop: 4,
            }}
          />
        )}
        {/* Its own Pressable, not decoration on the row: dismissing must
            never also open the deep-link, and a screen reader needs a named
            button. hitSlop keeps the 22px glyph a thumb-sized target. */}
        <Pressable
          testID={`notification-dismiss-${n.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss: ${n.title}`}
          onPress={onDismiss}
          hitSlop={10}
          style={({ pressed }) => ({ marginTop: 1, opacity: pressed ? 0.5 : 1 })}
        >
          <Text style={{ fontSize: 13, color: tokens.color.sub, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </Card>
    </Pressable>
  );

  // Only an unread row is wrapped — a read one must never be transform-hosted
  // by a gesture that will not fire, which is how content goes invisible.
  return unread ? <Animated.View style={pinStyle(pin)}>{row}</Animated.View> : row;
}

/**
 * The notification centre, shared by both portals (only `group` — which decides
 * where a tapped row deep-links — differs). Unread rows are grouped under "New",
 * read ones under "Earlier". Tapping a row marks just it read; "Mark all read"
 * clears the lot. Reads apply OPTIMISTICALLY so the bell/count update instantly,
 * with the server call fire-and-forget (a failure just leaves the row unread on
 * the next focus refetch).
 *
 * Dismissing (pitch №3): the ✕ on a row soft-clears just it; "Clear all" at
 * the foot empties the list. Both apply optimistically and fire-and-forget,
 * matching the read path — a failed call simply resurfaces the row on the
 * next focus refetch, which is the honest recovery.
 *
 * The bell navigates HERE (the popup slip is gone), and this is also the
 * landing route for a tapped push notification — one screen, reached one way,
 * with `lib/notification-links.ts` deciding where a tapped row deep-links.
 */
export function NotificationsScreen({ group }: { group: Group }) {
  const tokens = useTokens();
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      fetchNotifications()
        .then((r) => {
          if (!cancelled) setRows(r.notifications);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const markAll = () => {
    const now = new Date().toISOString();
    setRows((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? now })) ?? prev);
    markNotificationsRead().catch(() => {});
  };

  const dismiss = (n: NotificationRow) => {
    setRows((prev) => prev?.filter((x) => x.id !== n.id) ?? prev);
    clearNotifications([n.id]).catch(() => {});
  };

  const clearAll = () => {
    setRows([]);
    clearNotifications().catch(() => {});
  };

  const open = (n: NotificationRow) => {
    if (!n.readAt) {
      const now = new Date().toISOString();
      setRows((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: now } : x)) ?? prev);
      markNotificationsRead([n.id]).catch(() => {});
    }
    const route = routeFor(group, n);
    if (route) router.push(route);
  };

  const unread = (rows ?? []).filter((n) => !n.readAt);
  const earlier = (rows ?? []).filter((n) => n.readAt);

  return (
    <Screen>
      <SectionTitle
        title="Notifications"
        actionLabel={unread.length > 0 ? 'Mark all read' : undefined}
        onAction={markAll}
      />

      {error && (
        <Card>
          <Text testID="notifications-error" style={{ color: tokens.color.red }}>
            {error}
          </Text>
        </Card>
      )}
      {rows === null && !error && (
        <Page>
          <Empty>Looking for anything new…</Empty>
        </Page>
      )}
      {rows?.length === 0 && !error && (
        <Page>
          <Text
            testID="notifications-empty"
            style={{
              fontFamily: font.serif,
              fontStyle: 'italic',
              fontSize: 13,
              color: tokens.color.sub,
              textAlign: 'center',
              paddingVertical: 20,
              paddingHorizontal: 14,
            }}
          >
            You&apos;re all caught up. 🎉
          </Text>
        </Page>
      )}

      {unread.length > 0 && <Text style={groupLabel(tokens)}>New</Text>}
      {unread.map((n, i) => (
        <Row key={n.id} n={n} index={i} onPress={() => open(n)} onDismiss={() => dismiss(n)} />
      ))}
      {earlier.length > 0 && <Text style={groupLabel(tokens)}>Earlier</Text>}
      {earlier.map((n, i) => (
        <Row key={n.id} n={n} index={i} onPress={() => open(n)} onDismiss={() => dismiss(n)} />
      ))}

      {/* Clear all — quiet, at the very foot, in the red family: it removes
          things. Kept OFF the header so "Mark all read" (recoverable) and
          "clear everything" (a bigger gesture) can never be mistaken for one
          another in a hurry. */}
      {(rows?.length ?? 0) > 0 && (
        <Pressable
          testID="notifications-clear-all"
          accessibilityRole="button"
          onPress={clearAll}
          style={({ pressed }) => ({
            marginTop: 6,
            paddingVertical: 12,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: tokens.color.line,
            backgroundColor: tokens.color.surface,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ textAlign: 'center', color: tokens.color.red, fontWeight: '700', fontSize: 13 }}>
            Clear all
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}
