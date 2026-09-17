import { useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CalendarSheet } from './CalendarSheet';
import { Field, fieldInputStyle } from './AuthScaffold';
import { parseRupees, rupeeInput, rupees } from '@/lib/money';
import { formatDate } from '@/lib/portal';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

export { Field, fieldInputStyle };

/**
 * THE FIELD FAMILY. Login and Change password each styled their own
 * TextInput; the fee claim form needed an amount, a date, a method, a
 * reference and a photo. These are those, built on the gate's `Field` label
 * and `fieldInputStyle` rule so the whole app fills in a form the same way.
 */

/** A plain text field: label above, the pencil rule inks in on focus. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  testID,
  mono,
  ...rest
}: Omit<TextInputProps, 'style'> & { label: string; mono?: boolean }) {
  const tokens = useTokens();
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label}>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={fieldInputStyle(tokens, { focused, mono })}
        {...rest}
      />
    </Field>
  );
}

/**
 * Money. The ₹ is drawn, never typed; the figure is in the mono face; what
 * the caller receives is PAISE, so no screen ever divides by a hundred.
 */
export function MoneyField({
  label,
  valueMinor,
  onChangeMinor,
  testID,
}: {
  label: string;
  valueMinor: number;
  onChangeMinor: (minor: number) => void;
  testID?: string;
}) {
  const tokens = useTokens();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(rupeeInput(valueMinor));
  return (
    <Field label={label}>
      <View
        style={[
          fieldInputStyle(tokens, { focused }),
          { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 0 },
        ]}
      >
        <Text style={{ fontFamily: font.mono, fontSize: 16, color: tokens.color.sub }}>₹</Text>
        <TextInput
          testID={testID}
          value={text}
          onChangeText={(t) => {
            setText(t);
            onChangeMinor(parseRupees(t));
          }}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={tokens.color.placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{ flex: 1, paddingVertical: 12, fontFamily: font.mono, fontSize: 16, color: tokens.color.ink }}
        />
      </View>
    </Field>
  );
}

/** A date: reads as a date, taps into the month calendar the leave form already uses. */
export function DateField({
  label,
  value,
  onChange,
  testID,
  maxDate,
}: {
  label: string;
  /** YYYY-MM-DD */
  value: string;
  onChange: (iso: string) => void;
  testID?: string;
  /** Days after this are not pickable — a payment can't be dated tomorrow. */
  maxDate?: string;
}) {
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  return (
    <Field label={label}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDate(value)}`}
        onPress={() => setOpen(true)}
        style={[fieldInputStyle(tokens, { focused: open }), { justifyContent: 'center' }]}
      >
        <Text style={{ fontSize: 14.5, color: tokens.color.ink }}>{formatDate(value)}</Text>
      </Pressable>
      <CalendarSheet
        open={open}
        title={label}
        value={value}
        onPick={(iso) => {
          if (maxDate && iso > maxDate) return;
          onChange(iso);
        }}
        onClose={() => setOpen(false)}
      />
    </Field>
  );
}

/** A handful of options, one chosen — the accent fills the chosen one. Under ~6 options only. */
export function SegmentedField<V extends string>({
  label,
  options,
  value,
  onChange,
  testID,
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  testID?: string;
}) {
  const tokens = useTokens();
  return (
    <Field label={label}>
      <View
        testID={testID}
        accessibilityRole="radiogroup"
        style={{
          flexDirection: 'row',
          backgroundColor: tokens.color.surfaceMuted,
          borderRadius: 11,
          padding: 3,
          gap: 3,
        }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              testID={testID ? `${testID}-${o.value}` : undefined}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(o.value)}
              style={{
                flex: 1,
                minHeight: 34,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 9,
                backgroundColor: on ? tokens.color.indigo : 'transparent',
              }}
            >
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={{ fontSize: 12, fontWeight: '700', color: on ? tokens.color.onBrand : tokens.color.sub }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
}

/** The server's cap on a proof image; checked here so the refusal is a sentence, not a 413. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * A photo from the library — the payment screenshot. Optional by design: a
 * parent who paid cash at the counter has none, and refusing the claim for
 * want of an image would push them back to the counter.
 */
export function PhotoField({
  label,
  value,
  onChange,
  testID,
  hint = 'Add a screenshot — optional',
}: {
  label: string;
  value: PickedPhoto | null;
  onChange: (p: PickedPhoto | null) => void;
  testID?: string;
  hint?: string;
}) {
  const tokens = useTokens();
  const [problem, setProblem] = useState<string | null>(null);

  async function pick() {
    setProblem(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      // JPEG at 0.7 keeps a phone screenshot well under the 5 MB cap.
      quality: 0.7,
    });
    if (res.canceled || !res.assets || res.assets.length === 0) return;
    const a = res.assets[0];
    if (a.fileSize && a.fileSize > MAX_PHOTO_BYTES) {
      setProblem('That image is over 5 MB — please choose a smaller one.');
      return;
    }
    onChange({
      uri: a.uri,
      name: a.fileName ?? `proof-${Date.now()}.jpg`,
      type: a.mimeType ?? 'image/jpeg',
    });
  }

  return (
    <Field label={label}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${value.name}. Change` : `${label}: ${hint}`}
        onPress={() => void pick()}
        style={{
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: value ? tokens.color.indigo : tokens.color.line2,
          borderRadius: 11,
          paddingVertical: 12,
          paddingHorizontal: 13,
          minHeight: 46,
          justifyContent: 'center',
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            fontFamily: value ? font.sans : font.serif,
            fontStyle: value ? 'normal' : 'italic',
            fontSize: 13,
            color: value ? tokens.color.ink : tokens.color.sub,
          }}
        >
          {value ? value.name : hint}
        </Text>
      </Pressable>
      {value && (
        <Pressable
          testID={testID ? `${testID}-clear` : undefined}
          accessibilityRole="button"
          onPress={() => onChange(null)}
          hitSlop={8}
          style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
        >
          <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.indigo }}>Remove</Text>
        </Pressable>
      )}
      {problem && <Text style={{ fontSize: 12, color: tokens.color.red }}>{problem}</Text>}
    </Field>
  );
}

/** Small helper for the fee form: a plain money figure for a label row. */
export function MoneyLabel({ children }: { children: ReactNode }) {
  const tokens = useTokens();
  return <Text style={{ fontFamily: font.mono, fontSize: 13, color: tokens.color.ink }}>{children}</Text>;
}

export { rupees };
