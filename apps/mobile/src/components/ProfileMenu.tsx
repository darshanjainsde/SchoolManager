import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card } from './ui';
import { useTokens } from '@/theme/theme-context';

export interface ProfileMenuRow {
  /** Emoji glyph on the 30px tile — same voice as the profile's record rows. */
  icon: string;
  label: string;
  route: string;
  testID: string;
}

/**
 * THE PROFILE'S DOORS (pitch №7). The Appearance panel and the
 * change-password form used to sit fully unfolded on the Profile page —
 * two whole control surfaces on a screen visited mostly to glance at
 * facts, pushing Sign out below the fold. Each is now one ruled row that
 * pushes its own screen inside the profile stack; the controls themselves
 * are re-housed unchanged, and the back chip comes free from the
 * positional rule in `lib/screen-titles.ts`.
 *
 * The row anatomy mirrors the record card's `ProfileRow` (30px tile,
 * ruled separators) so the menu reads as more of the same record, plus a
 * chevron because these rows go somewhere.
 */
export function ProfileMenu({ rows }: { rows: ProfileMenuRow[] }) {
  const tokens = useTokens();
  return (
    <Card style={{ paddingVertical: 2 }}>
      {rows.map((row, i) => (
        <Pressable
          key={row.testID}
          testID={row.testID}
          accessibilityRole="button"
          accessibilityLabel={row.label}
          onPress={() => router.push(row.route as Parameters<typeof router.push>[0])}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
            paddingVertical: 12,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: tokens.color.line,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              backgroundColor: tokens.color.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 14 }}>{row.icon}</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: tokens.color.ink }}>
            {row.label}
          </Text>
          <Text style={{ fontSize: 15, fontWeight: '800', color: tokens.color.sub }}>›</Text>
        </Pressable>
      ))}
    </Card>
  );
}
