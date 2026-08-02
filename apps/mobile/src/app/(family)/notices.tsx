import { useCallback, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { relativeTime, type Announcement } from '@/lib/portal';
import { Card, Screen, SectionTitle } from '@/components/ui';
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
 * Opening a notice also marks it read for this visit: the amber slip drops to
 * the plain `.notice.read` treatment and loses its pin, so a board that has
 * been worked through LOOKS worked through. Purely local (there is no
 * read-receipt endpoint for announcements) — nothing is sent, and a fresh
 * fetch shows every notice unread again.
 */
function NoticeRow({ a, index }: { a: Announcement; index: number }) {
  const tokens = useTokens();
  const [expanded, setExpanded] = useState(false);
  const [read, setRead] = useState(false);
  const pin = useGesture(true, DUR.pin, { delay: 150 + index * 180 });

  return (
    <Animated.View style={pinStyle(pin)}>
      <Pressable
        testID={`notice-${a.id}`}
        accessibilityRole="button"
        onPress={() => {
          setExpanded((e) => !e);
          setRead(true);
        }}
      >
        <Card
          style={{
            backgroundColor: read ? tokens.color.surface : tokens.color.amber50,
            borderColor: read ? tokens.color.line : 'transparent',
            borderRadius: 11,
            padding: 12,
          }}
        >
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: read ? tokens.color.sub : tokens.color.late }}>
            {a.title}
          </Text>
          <Text
            style={{
              fontSize: 10,
              marginTop: 2,
              color: read ? tokens.color.sub : tokens.color.late,
              opacity: read ? 1 : 0.75,
            }}
          >
            {a.classSectionId ? 'Your class' : 'Whole school'} · {relativeTime(a.createdAt)}
          </Text>
          <Text
            style={{
              fontSize: 12.5,
              color: read ? tokens.color.sub : tokens.color.ink2,
              marginTop: 7,
              lineHeight: 17,
            }}
            numberOfLines={expanded ? undefined : 2}
          >
            {a.body}
          </Text>
          <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.indigo, marginTop: 5 }}>
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </Card>

        {/* The pin itself: a red bead through the top-left corner of the
            slip. It goes when the notice has been read — the slip is still
            on the board, it just isn't demanding attention any more. */}
        {!read && (
          <View
            style={{
              position: 'absolute',
              top: -5,
              left: 24,
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: tokens.color.marginRed,
            }}
          />
        )}
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
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading notices…</Text>
        </Card>
      )}
      {items?.length === 0 && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>No notices yet — school updates will appear here.</Text>
        </Card>
      )}
      {items?.map((a, i) => (
        <NoticeRow key={a.id} a={a} index={i} />
      ))}
    </Screen>
  );
}
