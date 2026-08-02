import { useCallback, useState } from 'react';
import { Pressable, Text, View, type TextStyle } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { NotificationRow } from '@skoolos/types';
import { ApiError } from '@/lib/api';
import { fetchNotifications, markNotificationsRead } from '@/lib/notifications';
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
function Row({ n, index, onPress }: { n: NotificationRow; index: number; onPress: () => void }) {
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
          opacity: unread ? 1 : 0.55,
          backgroundColor: unread ? tokens.color.surface : tokens.color.appBg,
          borderColor: unread ? tokens.color.line2 : tokens.color.line,
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
 * Since the paper-slip repaint the BELL no longer opens this screen — it
 * unfolds `NotificationSlip` in place over whatever you were reading. This
 * screen stays the full-page surface behind the slip's "See all
 * notifications", and remains the landing route for a tapped push
 * notification; both surfaces share `lib/notification-links.ts` so a row goes
 * to the same place from either.
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
        <Row key={n.id} n={n} index={i} onPress={() => open(n)} />
      ))}
      {earlier.length > 0 && <Text style={groupLabel(tokens)}>Earlier</Text>}
      {earlier.map((n, i) => (
        <Row key={n.id} n={n} index={i} onPress={() => open(n)} />
      ))}
    </Screen>
  );
}
