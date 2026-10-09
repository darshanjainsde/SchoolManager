import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { CalendarSheet } from './CalendarSheet';
import { Sheet } from './Sheet';
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

/** A plain text field: label above, a white box that takes the accent on focus. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  testID,
  mono,
  hint,
  error,
  optional,
  maxLength,
  multiline,
  ...rest
}: Omit<TextInputProps, 'style'> & {
  label: string;
  mono?: boolean;
  /** The line under the box; an `error` replaces it in place. */
  hint?: string;
  error?: string | null;
  optional?: boolean;
}) {
  const tokens = useTokens();
  const [focused, setFocused] = useState(false);
  const len = typeof value === 'string' ? value.length : 0;
  // A counter only once the limit is near (GOV.UK: past ~75%), never a silent cut.
  const counter = maxLength && len >= maxLength * 0.75 ? `${len} / ${maxLength}` : undefined;
  return (
    <Field label={label} hint={hint} error={error} optional={optional} counter={counter}>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.placeholder}
        maxLength={maxLength}
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={fieldInputStyle(tokens, { focused, mono, error: !!error, multiline })}
        {...rest}
      />
    </Field>
  );
}

/**
 * Money. The ₹ is drawn, never typed; the figure is in sans with tabular digits; what
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
          style={{ flex: 1, paddingVertical: 12, fontVariant: ['tabular-nums'], fontSize: 16, color: tokens.color.ink }}
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
  minDate,
  quick,
}: {
  label: string;
  /** YYYY-MM-DD */
  value: string;
  onChange: (iso: string) => void;
  testID?: string;
  /** Days after this are not pickable — a payment can't be dated tomorrow. */
  maxDate?: string;
  /** Days before this are not pickable — homework can't be due yesterday. */
  minDate?: string;
  /** One-tap shortcuts under the box ("Tomorrow", "In a week"). */
  quick?: readonly { label: string; iso: string }[];
}) {
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  return (
    <Field label={label}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${weekdayDate(value)}. Opens a calendar.`}
        onPress={() => setOpen(true)}
        style={[fieldInputStyle(tokens, { focused: open }), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
      >
        <Text style={{ fontSize: 16, color: tokens.color.ink }}>{weekdayDate(value)}</Text>
        <ChevronDown color={tokens.color.sub} />
      </Pressable>
      {quick && quick.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {quick.map((q) => {
            const on = q.iso === value;
            return (
              <Pressable
                key={q.label}
                testID={testID ? `${testID}-quick-${q.label.replace(/\s+/g, '-').toLowerCase()}` : undefined}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => onChange(q.iso)}
                hitSlop={6}
                style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? tokens.color.indigo : tokens.color.indigo50 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: on ? tokens.color.onBrand : tokens.color.indigo }}>{q.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <CalendarSheet
        open={open}
        title={label}
        value={value}
        minDate={minDate}
        onPick={(iso) => {
          if (maxDate && iso > maxDate) return;
          if (minDate && iso < minDate) return;
          onChange(iso);
        }}
        onClose={() => setOpen(false)}
      />
    </Field>
  );
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Fri, 9 Oct 2026" — the weekday is what a teacher plans by. */
export function weekdayDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WD[wd]}, ${d} ${MO[m - 1]} ${y}`;
}

export function ChevronDown({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
      <Path d="M6 9l6 6 6-6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export interface SelectOption {
  id: string;
  label: string;
  /** A second line ("27 students", "MATH"). */
  sub?: string;
  /** Options with the same group are listed under that heading, in first-seen order. */
  group?: string;
}

/**
 * THE DROPDOWN (sckools-ui-standards, 9 Oct 2026). A row of chips is right
 * for two or three short choices; past that — 16 subject CODES, five leave
 * types, a teacher's classes — it becomes a wall a person has to decode.
 * This is a 56 dp field showing the full name, opening a sheet of 56 dp rows
 * with the chosen one ticked; past eight options the sheet gets a search box.
 *
 * Option rows keep caller testIDs (`optionTestID`) so screen tests can still
 * pick "subject-<id>" once the field is opened.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  testID,
  optionTestID,
  sheetTitle,
  disabled,
  searchable: searchableProp,
  subInField = true,
}: {
  label: string;
  value: string | null | undefined;
  options: readonly SelectOption[];
  /** Defaults to "more than eight options"; a list of times needs no search. */
  searchable?: boolean;
  /** Show the chosen option's second line inside the box (off when the screen says it elsewhere). */
  subInField?: boolean;
  onChange: (id: string) => void;
  placeholder?: string;
  testID?: string;
  optionTestID?: (id: string) => string;
  sheetTitle?: string;
  disabled?: boolean;
}) {
  const tokens = useTokens();
  const c = tokens.color;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = options.find((o) => o.id === value);
  const searchable = searchableProp ?? options.length > 8;
  const listRef = useRef<ScrollView>(null);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.sub ?? '').toLowerCase().includes(needle))
    : options;
  const groups: { name: string | undefined; items: SelectOption[] }[] = [];
  for (const o of shown) {
    const g = groups.find((x) => x.name === o.group);
    if (g) g.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }
  return (
    <Field label={label}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen ? chosen.label : 'not chosen'}. Opens a list.`}
        disabled={disabled}
        onPress={() => {
          setQ('');
          setOpen(true);
        }}
        style={[
          fieldInputStyle(tokens, { focused: open }),
          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, opacity: disabled ? 0.55 : 1 },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, color: chosen ? c.ink : c.placeholder }}>
            {chosen ? chosen.label : placeholder}
          </Text>
        </View>
        {subInField && chosen?.sub ? <Text style={{ fontSize: 13, color: c.sub }}>{chosen.sub}</Text> : null}
        <ChevronDown color={c.sub} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={sheetTitle ?? label} testID={testID ? `${testID}-sheet` : undefined}>
        {searchable ? (
          <TextInput
            testID={testID ? `${testID}-search` : undefined}
            value={q}
            onChangeText={setQ}
            placeholder={`Search ${label.toLowerCase()}`}
            placeholderTextColor={c.placeholder}
            autoCorrect={false}
            style={[fieldInputStyle(tokens, { focused: false }), { marginBottom: 8 }]}
          />
        ) : null}
        <ScrollView
          ref={listRef}
          style={{ maxHeight: 420 }}
          keyboardShouldPersistTaps="handled"
          // Open on the chosen option, not the top of a long list (9:00 am,
          // not 7:00 am). Rows are 56 dp; leave two above it in view.
          onLayout={() => {
            const i = shown.findIndex((o) => o.id === value);
            if (i > 2) listRef.current?.scrollTo({ y: (i - 2) * 56, animated: false });
          }}
        >
          {groups.map((g) => (
            <View key={g.name ?? '_'}>
              {g.name ? (
                <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: c.sub, marginTop: 12, marginBottom: 4 }}>
                  {g.name}
                </Text>
              ) : null}
              {g.items.map((o) => {
                const on = o.id === value;
                return (
                  <Pressable
                    key={o.id}
                    testID={optionTestID ? optionTestID(o.id) : testID ? `${testID}-option-${o.id}` : undefined}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={o.label}
                    onPress={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      minHeight: 56,
                      paddingHorizontal: 12,
                      borderRadius: 16,
                      backgroundColor: on ? c.indigo50 : pressed ? c.surfaceMuted : 'transparent',
                    })}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: on ? '600' : '400', color: on ? c.indigo : c.ink }}>{o.label}</Text>
                      {o.sub ? <Text style={{ fontSize: 13, color: c.sub, marginTop: 1 }}>{o.sub}</Text> : null}
                    </View>
                    {on ? (
                      <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
                        <Path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={c.indigo} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
          {shown.length === 0 ? (
            <Text style={{ fontSize: 14, color: c.sub, paddingVertical: 16, textAlign: 'center' }}>Nothing matches “{q}”.</Text>
          ) : null}
        </ScrollView>
      </Sheet>
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
          borderRadius: 999,
          padding: 4,
          gap: 4,
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
                minHeight: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                backgroundColor: on ? tokens.color.surface : 'transparent',
                borderWidth: on ? 1 : 0,
                borderColor: tokens.color.line2,
              }}
            >
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={{ fontSize: 14, fontWeight: '700', color: on ? tokens.color.ink : tokens.color.sub }}
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
  return <Text style={{ fontVariant: ['tabular-nums'], fontSize: 13, color: tokens.color.ink }}>{children}</Text>;
}

export { rupees };
