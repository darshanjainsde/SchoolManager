import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { fetchUnreadCount } from '@/lib/notifications';
import type { NotificationGroup } from '@/lib/notification-links';
import { NotificationSlip } from '@/components/NotificationSlip';
import { useTokens } from '@/theme/theme-context';
import { brand } from '@/theme/tokens';

/**
 * The notification bell for a screen header (both portals). Self-contained: it
 * refetches its unread count every time the host screen focuses, so a
 * notification read elsewhere shows the decremented number. A count fetch that
 * fails is swallowed — a header badge must never surface an error.
 *
 * Tapping it does NOT navigate. It unfolds `NotificationSlip` — a slip of
 * paper — downward over the screen you are already on, and the badge counts
 * down live as rows are read inside it. Everything the slip needs is state it
 * owns; the bell only lends it a place to report the remaining count.
 */
export function NotificationBell({ group }: { group: NotificationGroup }) {
  const tokens = useTokens();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

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
    <>
      <Pressable
        testID="notification-bell"
        accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={{
          // `.bell` — 31px, radius 9, a pencil-rule border on paper.
          width: 31,
          height: 31,
          borderRadius: 9,
          backgroundColor: tokens.color.surface,
          borderColor: tokens.color.line,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 14 }}>🔔</Text>
        {count > 0 && (
          <View
            testID="notification-bell-badge"
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              minWidth: 17,
              height: 17,
              borderRadius: 99,
              paddingHorizontal: 3,
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
      <NotificationSlip
        group={group}
        visible={open}
        onClose={() => setOpen(false)}
        onUnreadChange={setCount}
      />
    </>
  );
}
