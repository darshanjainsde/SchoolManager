import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { fetchUnreadCount } from '@/lib/notifications';
import type { NotificationGroup } from '@/lib/notification-links';
import { useTokens } from '@/theme/theme-context';
import { brand } from '@/theme/tokens';

/**
 * The notification bell for a screen header (both portals). Self-contained: it
 * refetches its unread count every time the host screen focuses, so a
 * notification read elsewhere shows the decremented number. A count fetch that
 * fails is swallowed — a header badge must never surface an error.
 *
 * Tapping it navigates to the full notifications screen (pitch №3): the old
 * slip unfolded a popup over the status bar and showed one row, which read as
 * broken chrome rather than an inbox. One screen, reached one way — this route
 * is also where a tapped push notification lands, so the two entrances agree.
 *
 * 38px with a DRAWN glyph, not the 🔔 emoji: the emoji renders differently on
 * every Android vendor and cannot take the theme's ink colour. `alignSelf:
 * 'center'` seats the tile on the optical centre of the two-line name block
 * beside it instead of hanging from the row's top edge.
 */
export function NotificationBell({ group }: { group: NotificationGroup }) {
  const tokens = useTokens();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchUnreadCount()
        .then((r) => {
          if (!cancelled) setCount(r.count);
        })
        .catch(() => {
          /* a badge must never surface an error */
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <Pressable
      testID="notification-bell"
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      onPress={() => router.push(`/${group}/(tabs)/home/notifications`)}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.line,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name="notifications-outline" size={19} color={tokens.color.ink} />
      {count > 0 && (
        <View
          testID="notification-bell-badge"
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: 18,
            height: 18,
            borderRadius: 99,
            paddingHorizontal: 4,
            // `--margin-red`, the red of a margin rule / an unread mark —
            // lighter and warmer than `red`, which this product reserves for
            // remark ink itself.
            backgroundColor: tokens.color.marginRed,
            // The 2px cut-out is the PAGE colour, not the bell's, so the
            // badge reads as sitting on top of the page rather than inside
            // the bell's own outline.
            borderColor: tokens.color.appBg,
            borderWidth: 2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* A number inside an 18px circle — it cannot grow with the OS
              setting without becoming a clipped glyph. */}
          <Text maxFontSizeMultiplier={1.2} style={{ color: brand.onHero, fontSize: 10, fontWeight: '800' }}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
