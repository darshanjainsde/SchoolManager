import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * Pitch №5 §3 — the way back, on every pushed screen. Until now headers were
 * off everywhere and only the gesture / hardware back existed, which is
 * invisible; parents in particular got stranded on tool screens.
 *
 * The chip is the NotificationBell's 38px tile verbatim — same size, radius,
 * surface and hairline — so the two ends of a screen's chrome speak one
 * language. The title is the diary SERIF: the page names itself in the
 * page's own voice, the chrome around it stays sans.
 *
 * Sits ABOVE the scroll, not inside it: a back affordance that can scroll
 * off the screen is a back affordance that sometimes is not there. It owns
 * the top safe-area inset, so hosts under it must not add `insets.top` again.
 */
export function BackChipHeader({ title }: { title: string }) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + 6,
        paddingBottom: 8,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: tokens.color.appBg,
      }}
    >
      <Pressable
        testID="back-chip"
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
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
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="chevron-back" size={19} color={tokens.color.ink} />
      </Pressable>
      {/* A title beside a 38px tile is fixed-geometry chrome — capped, like
          the tab labels (see text-scaling.test.ts). */}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
        style={{
          fontFamily: font.serif,
          fontSize: 17,
          fontWeight: '600',
          letterSpacing: -0.2,
          color: tokens.color.ink,
          flex: 1,
        }}
      >
        {title}
      </Text>
    </View>
  );
}
