import { type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTokens } from '@/theme/theme-context';
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
  /** Inline in a row: shorter, but the hit area still clears 44 dp. */
  small?: boolean;
}) {
  const tokens = useTokens();
  const off = !!disabled || !!busy;
  const bg = variant === 'primary' ? tokens.color.indigo : variant === 'amber' ? tokens.color.amber50 : 'transparent';
  const fg = variant === 'primary' ? tokens.color.onBrand : variant === 'danger' ? tokens.color.red : variant === 'amber' ? tokens.color.late : tokens.color.indigo;
  const border = variant === 'danger' ? tokens.color.red : variant === 'amber' ? tokens.color.amber50 : tokens.color.indigo;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      hitSlop={small ? 6 : 0}
      style={({ pressed }) => ({
        minHeight: small ? 34 : 44,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: small ? 12 : 14,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        opacity: off ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <Text numberOfLines={1} style={{ color: fg, fontWeight: '700', fontSize: small ? 12.5 : 13.5 }}>
        {busy ? `${label}…` : label}
      </Text>
    </Pressable>
  );
}

/** The counter's one search line — a name, a code, an accession number. */
export function SearchBox({ value, onChangeText, placeholder, testID, autoFocus, onSubmit, ...rest }: Omit<TextInputProps, 'style'> & { onSubmit?: () => void }) {
  const tokens = useTokens();
  return (
    <View style={{ backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.line, borderRadius: 13, paddingHorizontal: 13, minHeight: 46, justifyContent: 'center' }}>
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
        style={{ fontSize: 14.5, color: tokens.color.ink, paddingVertical: 10 }}
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
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: tokens.color.ink, fontFamily: mono ? font.mono : undefined }}>{title}</Text>
        {sub ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      {right}
    </>
  );
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 10, paddingHorizontal: 12, minHeight: 48, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.color.line };
  if (!onPress) return <View testID={testID} style={style}>{body}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} style={({ pressed }) => ({ ...style, backgroundColor: pressed ? tokens.color.indigo50 : 'transparent' })}>
      {body}
    </Pressable>
  );
}

/** A number box for a score or a mark — 44 dp, mono, selects on focus so a retype replaces. */
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
      style={{ width, minHeight: 44, borderWidth: 1, borderColor: tokens.color.line, borderRadius: 10, backgroundColor: tokens.color.surface, textAlign: 'center', fontFamily: font.mono, fontSize: 15, color: tokens.color.ink, paddingHorizontal: 6 }}
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
