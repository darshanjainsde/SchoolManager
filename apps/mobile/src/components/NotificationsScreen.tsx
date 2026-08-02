import { useCallback, useState } from 'react';
import { Pressable, Text, View, type TextStyle } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { NotificationRow } from '@skoolos/types';
import { ApiError } from '@/lib/api';
import { fetchNotifications, markNotificationsRead } from '@/lib/notifications';
import { KIND_ICON, formatWhen, routeFor, type NotificationGroup } from '@/lib/notification-links';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import type { ColorPalette } from '@/theme/tokens';

type Group = NotificationGroup;

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

function Row({ n, onPress }: { n: NotificationRow; onPress: () => void }) {
  const tokens = useTokens();
  const unread = !n.readAt;
  return (
    <Pressable testID={`notification-${n.id}`} onPress={onPress}>
      <Card
        style={{
          flexDirection: 'row',
          gap: 11,
          alignItems: 'flex-start',
          backgroundColor: unread ? tokens.color.indigo50 : tokens.color.surface,
          borderColor: unread ? tokens.color.indigo : tokens.color.line,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: tokens.color.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 16 }}>{KIND_ICON[n.kind] ?? '🔔'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{n.title}</Text>
          {n.body ? (
            <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 2 }} numberOfLines={2}>
              {n.body}
            </Text>
          ) : null}
          <Text style={{ fontSize: 10.5, color: tokens.color.sub, marginTop: 3 }}>{formatWhen(n.createdAt)}</Text>
        </View>
        {unread && (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.color.indigo, marginTop: 4 }} />
        )}
      </Card>
    </Pressable>
  );
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
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading…</Text>
        </Card>
      )}
      {rows?.length === 0 && !error && (
        <Card>
          <Text testID="notifications-empty" style={{ color: tokens.color.sub }}>
            You&apos;re all caught up. 🎉
          </Text>
        </Card>
      )}

      {unread.length > 0 && <Text style={groupLabel(tokens)}>New</Text>}
      {unread.map((n) => (
        <Row key={n.id} n={n} onPress={() => open(n)} />
      ))}
      {earlier.length > 0 && <Text style={groupLabel(tokens)}>Earlier</Text>}
      {earlier.map((n) => (
        <Row key={n.id} n={n} onPress={() => open(n)} />
      ))}
    </Screen>
  );
}
