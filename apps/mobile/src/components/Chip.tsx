import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { Icon } from './icons';
import { useTokens } from '@/theme/theme-context';

/**
 * THE ONE CHIP (UI v2, 2026-10-08).
 *
 * Material 3's filter chip in the app's shape: 36 dp tall (hit area 48 with
 * hitSlop), radius from the token file, label 14/600. Selected = tinted fill
 * + brand border + a drawn tick; unselected = surface + hairline. `tone:
 * 'red'` is for a choice that itself carries weight (a REMARK in the diary).
 *
 * Before this three screens each owned a `chipStyle(tokens, on)` helper at
 * 11 px corners and 12.5 px text, and showed selection by prefixing the
 * label with a text "✓" — which shifted the chip's width on every tap.
 */
export function Chip({
  label,
  selected,
  onPress,
  tone = 'indigo',
  disabled,
  testID,
  accessibilityLabel,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  tone?: 'indigo' | 'red';
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const tokens = useTokens();
  const c = tokens.color;
  const on = !!selected;
  const accent = tone === 'red' ? c.red : c.indigo;
  const fill = tone === 'red' ? c.red50 : c.indigo50;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          minHeight: 36,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: on ? 10 : 14,
          borderRadius: tokens.radius.chip,
          borderWidth: 1.5,
          borderColor: on ? accent : c.line,
          backgroundColor: on ? fill : c.surface,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {on ? <View><Icon name="check" size={16} color={accent} fillOpacity={0.2} /></View> : null}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 14, lineHeight: 20, fontWeight: '600', color: on ? accent : c.ink2 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A wrapping row of chips: 8 dp apart, the Material 3 spacing between chips. */
export function ChipRow({ children, testID, style }: { children: React.ReactNode; testID?: string; style?: ViewStyle }) {
  return <View testID={testID} style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, style]}>{children}</View>;
}
