import { type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTokens } from '@/theme/theme-context';
import { Button as AppButton } from './Button';
import { Icon } from './icons';
import { font } from '@/theme/tokens';

/**
 * THE DESK KIT — the few controls the two desks (sports, library) share
 * with each other and with nothing else in the app: a button in three
 * weights, a search line, a ruled list row, and a lane/score number box.
 * All 44 dp tall, because a desk is worked with a thumb between children.
 */

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  testID,
  small,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'amber';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  /** Inline in a row: shorter, but the hit area still clears 48 dp. */
  small?: boolean;
}) {
  // UI v2: the desk's four weights map onto the one app Button
  // (components/Button.tsx) so every button in the app is the same pill.
  const map = { primary: 'filled', ghost: 'outlined', danger: 'danger', amber: 'tonal' } as const;
  return (
    <AppButton
      label={label}
      onPress={onPress}
      variant={map[variant]}
      size={small ? 'sm' : 'md'}
      disabled={disabled}
      busy={busy}
      testID={testID}
    />
  );
}

/** The counter's one search line — a name, a code, an accession number. */
export function SearchBox({ value, onChangeText, placeholder, testID, autoFocus, onSubmit, ...rest }: Omit<TextInputProps, 'style'> & { onSubmit?: () => void }) {
  const tokens = useTokens();
  // UI v2: a 52 dp pill with the glass at the start, the way every search on a
  // phone is drawn now; the box is the page's one big affordance on a desk.
  return (
    <View style={{ backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.line2, borderRadius: 26, paddingLeft: 16, paddingRight: 12, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name="search" size={20} color={tokens.color.sub} fillOpacity={0.12} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.placeholder}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        clearButtonMode="while-editing"
        accessibilityLabel={typeof placeholder === 'string' ? placeholder : 'Search'}
        style={{ flex: 1, fontSize: 16, color: tokens.color.ink, paddingVertical: 12 }}
        {...rest}
      />
    </View>
  );
}

/** One ruled row inside a Page: title, a dim second line, something on the right. */
export function Row({ title, sub, right, first, onPress, testID, accessibilityLabel, mono }: {
  title: string; sub?: string; right?: ReactNode; first?: boolean; onPress?: () => void; testID?: string; accessibilityLabel?: string;
  /** The title is a figure (an accession number, a code) and lines up better in mono. */
  mono?: boolean;
}) {
  const tokens = useTokens();
  const body = (
    <>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color: tokens.color.ink, fontFamily: mono ? font.mono : undefined }}>{title}</Text>
        {sub ? <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      {right}
    </>
  );
  // Material 3 list rows: 56 dp one line, 72 two, 16 dp keyline.
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 10, paddingHorizontal: 16, minHeight: sub ? 72 : 56, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.color.line };
  if (!onPress) return <View testID={testID} style={style}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} style={({ pressed }) => ({ ...style, backgroundColor: pressed ? tokens.color.indigo50 : 'transparent' })}>
      {body}
    </Pressable>
  );
}

/** A number box for a score or a mark — 44 dp, tabular figures, selects on focus so a retype replaces. */
export function NumberBox({ value, onChangeText, testID, placeholder, width = 64, decimal, onSubmitEditing, returnKeyType, inputRef }: {
  value: string; onChangeText: (v: string) => void; testID?: string; placeholder?: string; width?: number; decimal?: boolean;
  onSubmitEditing?: () => void; returnKeyType?: TextInputProps['returnKeyType']; inputRef?: React.Ref<TextInput>;
}) {
  const tokens = useTokens();
  return (
    <TextInput
      ref={inputRef}
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={tokens.color.placeholder}
      keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
      selectTextOnFocus
      returnKeyType={returnKeyType}
      blurOnSubmit={false}
      onSubmitEditing={onSubmitEditing}
      accessibilityLabel={placeholder}
      style={{ width, minHeight: 48, borderWidth: 1, borderColor: tokens.color.line2, borderRadius: 14, backgroundColor: tokens.color.surface, textAlign: 'center', fontVariant: ['tabular-nums'], fontSize: 16, color: tokens.color.ink, paddingHorizontal: 6 }}
    />
  );
}

/** A tone swatch — a house colour, a lane. */
export function Swatch({ color, size = 12 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** "Meet · Day 2" style section eyebrow. */
export function Eyebrow({ children }: { children: ReactNode }) {
  const tokens = useTokens();
  return <Text style={{ fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: tokens.color.sub, fontWeight: '700', paddingHorizontal: 4, marginTop: 4 }}>{children}</Text>;
}
