import { Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTokens } from '@/theme/theme-context';

/**
 * The gear beside the notification bell on a portal's home screen.
 *
 * Sits next to the bell rather than inside the tools drawer because it is not
 * a tool — it is how the app itself is adjusted, and people look for it in the
 * top-right corner of a home screen before anywhere else.
 *
 * 44pt hit area with a 20pt glyph: the icon reads as light chrome, the target
 * is still thumb-sized.
 */
export function SettingsButton({ group }: { group: '(staff)' | '(family)' }): React.JSX.Element {
  const tokens = useTokens();
  return (
    <Pressable
      testID="settings-button"
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={8}
      onPress={() => router.push(`/${group}/settings`)}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.55 : 1,
      })}
    >
      <Ionicons name="settings-outline" size={20} color={tokens.color.sub} />
    </Pressable>
  );
}
