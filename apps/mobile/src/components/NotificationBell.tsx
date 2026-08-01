import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { fetchUnreadCount } from '@/lib/notifications';
import { useTokens } from '@/theme/theme-context';
import { brand } from '@/theme/tokens';

/**
 * The notification bell for a screen header (both portals). Self-contained: it
 * refetches its unread count every time the host screen focuses, so returning
 * from the notifications screen shows the decremented number. A count fetch that
 * fails is swallowed — a header badge must never surface an error.
 */
export function NotificationBell({ onPress }: { onPress: () => void }) {
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
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 36,
        height: 36,
        borderRadius: 11,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.line,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 17 }}>🔔</Text>
      {count > 0 && (
        <View
          testID="notification-bell-badge"
          style={{
            position: 'absolute',
            top: -5,
            right: -5,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: tokens.color.red,
            borderColor: tokens.color.appBg,
            borderWidth: 2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: brand.onHero, fontSize: 10, fontWeight: '800' }}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}
