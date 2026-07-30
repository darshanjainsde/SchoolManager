import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { relativeTime, type Announcement } from '@/lib/portal';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/**
 * S8's bug: the body was never rendered at all, and rows weren't tappable —
 * a notice was literally unreadable on the phone. Fixed here as an
 * expand-on-tap row (collapsed to a 2-line preview, full text on tap)
 * rather than always showing the full body inline like the web does: a
 * notices FEED (unlike the web's dedicated announcements page) is a list a
 * student scrolls through repeatedly, and an always-expanded long body would
 * push everything else off-screen. `numberOfLines` only truncates the
 * VISUAL layout — the full body text is always present in the tree, so it
 * is always accessible to a screen reader regardless of expand state.
 */
function NoticeRow({ a }: { a: Announcement }) {
  const tokens = useTokens();
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable testID={`notice-${a.id}`} onPress={() => setExpanded((e) => !e)} accessibilityRole="button">
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
          <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>{a.title}</Text>
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
      {items?.map((a) => (
        <NoticeRow key={a.id} a={a} />
      ))}
    </Screen>
  );
}
