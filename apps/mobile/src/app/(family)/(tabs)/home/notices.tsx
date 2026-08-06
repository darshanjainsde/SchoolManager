import { useCallback, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { relativeTime, type Announcement } from '@/lib/portal';
import { Card, Empty, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { DUR, pinStyle, useGesture } from '@/theme/motion';
import { useTokens } from '@/theme/theme-context';

/**
 * One `.notice` — a slip pinned to the board.
 *
 * THE PIN is the gesture here, and it is the whole point of the screen: a
 * notice is something ADDED to a shared board by somebody else, so it drops
 * in from above, slightly askew, and settles straight under a red pin. The
 * six gestures reserve the pin for exactly this (a new diary line, a posted
 * announcement) — anything that arrives on the page rather than being
 * computed by it. `index` staggers the drop so a board of notices reads as
 * being pinned up one after another instead of materialising as a block.
 *
 * S8's bug: the body was never rendered at all, and rows weren't tappable —
 * a notice was literally unreadable on the phone. Fixed here as an
 * expand-on-tap row (collapsed to a 2-line preview, full text on tap)
 * rather than always showing the full body inline like the web does: a
 * notices FEED (unlike the web's dedicated announcements page) is a list a
 * student scrolls through repeatedly, and an always-expanded long body would
 * push everything else off-screen. `numberOfLines` only truncates the
 * VISUAL layout — the full body text is always present in the tree, so it
 * is always accessible to a screen reader regardless of expand state.
 *
 * NO local "read" state. The repaint dimmed a notice the instant you tapped
 * it — dropping the title, the meta AND the body to `sub` — so the act of
 * opening a circular made it harder to read, and the state was a fiction
 * anyway (there is no read-receipt endpoint for announcements, so a refetch
 * showed everything unread again). The tint likewise stays on the ICON: a
 * whole board of solid amber slips with amber body text is one colour where
 * the reader needs a column of legible sentences.
 */
function NoticeRow({ a, index }: { a: Announcement; index: number }) {
  const tokens = useTokens();
  const [expanded, setExpanded] = useState(false);
  const pin = useGesture(true, DUR.pin, { delay: 150 + index * 180 });

  return (
    <Animated.View style={pinStyle(pin)}>
      <Pressable
        testID={`notice-${a.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((e) => !e)}
      >
        <Card style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: tokens.color.indigo50,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 16 }}>📣</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{a.title}</Text>
            <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
              {a.classSectionId ? 'Your class' : 'Whole school'} · {relativeTime(a.createdAt)}
            </Text>
            <Text
              style={{ fontSize: 12.5, color: tokens.color.ink, marginTop: 6, lineHeight: 17 }}
              numberOfLines={expanded ? undefined : 2}
            >
              {a.body}
            </Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.indigo, marginTop: 4 }}>
              {expanded ? 'Show less' : 'Show more'}
            </Text>
          </View>
        </Card>
      </Pressable>
    </Animated.View>
  );
}

export default function Notices() {
  const tokens = useTokens();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus so a fresh notice posted while the app was backgrounded
  // shows up without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<Announcement[]>('/me/announcements')
        .then((data) => {
          if (!cancelled) setItems(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <Screen>
      <SectionTitle title="Notices" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        School circulars — the diary holds the personal ones.
      </Text>
      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {items === null && !error && (
        <LoadingRows label="Loading notices…" rows={3} />
      )}
      {items?.length === 0 && !error && (
        <Card style={{ padding: 0 }}>
          <Empty icon="notices">No notices yet — school updates will appear here.</Empty>
        </Card>
      )}
      {items?.map((a, i) => (
        <NoticeRow key={a.id} a={a} index={i} />
      ))}
    </Screen>
  );
}
