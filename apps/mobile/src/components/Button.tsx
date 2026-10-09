import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './icons';
import { useTokens } from '@/theme/theme-context';

/**
 * THE ONE BUTTON (UI v2, 2026-10-08).
 *
 * Material 3's four emphases, in the app's own shape: a pill, 48 dp tall
 * (the Android touch floor), label at 15/700. `filled` is the ONE main
 * action on a screen; `tonal` for the actions beside it; `outlined` for a
 * secondary that still needs a box (Reject, Cancel in a sheet); `text` for a
 * link-like action in a row. `danger` is an outlined button in the error
 * colour — a destructive choice never wears the brand fill.
 *
 * Before this the app had three button kits (desk Button, AuthButton, and
 * forty inline Pressables) at 32–44 dp with square-ish 11 px corners.
 * `desk.Button` and `AuthButton` now delegate here, so their callers did not
 * have to move.
 */
export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'filled',
  size = 'md',
  icon,
  disabled,
  busy,
  block,
  testID,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `md` = 48 dp; `sm` = 40 dp for a button inside a row (hit area still 48 with hitSlop). */
  size?: 'md' | 'sm';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  /** Full width: the sticky primary action at the foot of a form or a hero. */
  block?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const tokens = useTokens();
  const c = tokens.color;
  const off = !!disabled || !!busy;
  const palette = {
    filled: { bg: c.indigo, fg: c.onBrand, border: c.indigo },
    tonal: { bg: c.indigo50, fg: c.indigo, border: c.indigo50 },
    outlined: { bg: 'transparent', fg: c.indigo, border: c.line2 },
    text: { bg: 'transparent', fg: c.indigo, border: 'transparent' },
    danger: { bg: 'transparent', fg: c.red, border: c.line2 },
  }[variant];
  const height = size === 'sm' ? 40 : 48;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      hitSlop={size === 'sm' ? 4 : 0}
      style={({ pressed }) => [
        {
          minHeight: height,
          borderRadius: height / 2,
          paddingHorizontal: variant === 'text' ? 12 : size === 'sm' ? 16 : 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: palette.bg,
          borderWidth: variant === 'text' ? 0 : 1.5,
          borderColor: palette.border,
          opacity: off ? 0.45 : pressed ? 0.8 : 1,
          alignSelf: block ? 'stretch' : 'flex-start',
          transform: [{ scale: pressed && !off ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : icon ? (
        <View><Icon name={icon} size={size === 'sm' ? 18 : 20} color={palette.fg} fillOpacity={0.2} /></View>
      ) : null}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ color: palette.fg, fontWeight: '700', fontSize: size === 'sm' ? 14 : 15, letterSpacing: 0.1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
