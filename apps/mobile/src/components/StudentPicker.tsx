import { useMemo, useState } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, tokenStyle, useGesture } from '@/theme/motion';

export interface PickableStudent {
  id: string;
  name: string;
  rollNo?: string | null;
}

/**
 * One chosen child, as the pitch's `.tok`: an indigo-tinted pill OUTLINED in
 * the accent with a solid round ✕ on its trailing edge.
 *
 * THE TOKEN POP (`tokin`: `scale(.7)` + transparent → full size, 250ms) fires
 * once, on mount. It is the shortest of the six gestures on purpose — it does
 * not mean "something happened to the diary", it means "your tap was
 * ACCEPTED". A teacher who cannot see that a name landed taps the name again,
 * which is exactly the double-add this animation exists to prevent.
 */
function Token({
  label,
  onRemove,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onRemove: () => void;
  testID: string;
  accessibilityLabel: string;
}) {
  const tokens = useTokens();
  const pop = useGesture(true, DUR.token);
  return (
    <Animated.View style={tokenStyle(pop)}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onRemove}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: tokens.color.indigo50,
          borderColor: tokens.color.indigo,
          borderWidth: 1.5,
          borderRadius: tokens.radius.chip,
          paddingVertical: 4,
          paddingLeft: 11,
          paddingRight: 6,
        }}
      >
        <Text style={{ color: tokens.color.indigo, fontSize: 12, fontWeight: '700' }}>{label}</Text>
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: tokens.color.indigo,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: tokens.color.onBrand, fontSize: 10, fontWeight: '700' }}>✕</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Type a name → tap the match → it becomes a chip. The approved interaction
 * for choosing students (Phase 5·3), deliberately NOT a grid of every child:
 * a class of 100 turns a chip wall into a scanning exercise, while typing
 * three letters is the same three taps whether the class has 8 children or
 * 80. Selected children are shown as removable tokens above the field, so
 * "who is this about?" is answerable at a glance without reopening anything.
 *
 * Matching is case-insensitive on any part of the name plus the roll number,
 * so "sharma", "aarav" and "12" all find Aarav Sharma. Already-chosen
 * children drop out of the suggestions rather than appearing greyed — a
 * suggestion you cannot act on is noise.
 *
 * The suggestion list is the pitch's `.drop`/`.dropit`: a lifted sheet of
 * paper, hairline-ruled between rows, with the roll number pushed to the
 * right in the MONO face so a column of them lines up and can be scanned as
 * digits rather than read as words. It stays in the layout flow rather than
 * floating absolutely over the composer (the pitch's `position:absolute`),
 * because on a phone the composer is inside a scroll view where an
 * overflowing overlay is clipped on Android — a dropdown you cannot see is
 * worse than one that pushes the send button down by 40dp.
 */
export function StudentPicker({
  students,
  selected,
  onChange,
  placeholder = 'Type a name…',
  testID = 'student-picker',
  quickPhrases,
  onQuickPhrase,
}: {
  students: PickableStudent[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  testID?: string;
  /**
   * The pitch's `.quick`/`.qc` strip — the four or five sentences a teacher
   * writes over and over ("Test on Friday — revise Ch.5", "Bring ___
   * tomorrow"). Optional: a screen that has no house phrases simply omits
   * them and the strip does not render.
   */
  quickPhrases?: string[];
  /** Called with the tapped phrase, for the caller to drop into its composer. */
  onQuickPhrase?: (phrase: string) => void;
}) {
  const tokens = useTokens();
  const [query, setQuery] = useState('');

  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => !selected.includes(s.id))
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) || (s.rollNo ?? '').toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query, students, selected]);

  const add = (id: string) => {
    setQuery('');
    if (!selected.includes(id)) onChange([...selected, id]);
  };
  const remove = (id: string) => onChange(selected.filter((x) => x !== id));

  // The pitch's `.drop` — a lifted sheet, shared by the match list and the
  // "no match" row so both read as the same piece of paper.
  const dropSheet = {
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.line,
    borderWidth: 1,
    borderRadius: 11,
    overflow: 'hidden' as const,
    shadowColor: tokens.color.ink,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  };

  return (
    <View testID={testID} style={{ gap: 8 }}>
      {selected.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {selected.map((id) => (
            <Token
              key={id}
              testID={`token-${id}`}
              accessibilityLabel={`Remove ${byId.get(id)?.name ?? 'student'}`}
              label={byId.get(id)?.name ?? 'Student'}
              onRemove={() => remove(id)}
            />
          ))}
        </View>
      )}

      <TextInput
        testID={`${testID}-input`}
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.placeholder}
        autoCapitalize="words"
        autoCorrect={false}
        style={{
          backgroundColor: tokens.color.surface,
          // `.searchin` is outlined in the ACCENT, not the rule: the field is
          // the one live thing in the composer, and the pitch keeps it lit
          // whether or not it has focus.
          borderColor: tokens.color.indigo,
          borderWidth: 1.5,
          borderRadius: 10,
          paddingVertical: 11,
          paddingHorizontal: 13,
          fontSize: 14.5,
          color: tokens.color.ink,
        }}
      />

      {matches.length > 0 && (
        <View testID={`${testID}-matches`} style={dropSheet}>
          {matches.map((s, i) => (
            <Pressable
              key={s.id}
              testID={`match-${s.id}`}
              accessibilityRole="button"
              onPress={() => add(s.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                paddingVertical: 11,
                paddingHorizontal: 12,
                // `.dropit:hover{background:var(--indigo-tint)}` — a phone has
                // no hover, so the tint lands on press instead.
                backgroundColor: pressed ? tokens.color.indigo50 : tokens.color.surface,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: tokens.color.line,
              })}
            >
              <Text style={{ flex: 1, color: tokens.color.ink, fontSize: 13.5, fontWeight: '600' }}>
                {s.name}
              </Text>
              {s.rollNo ? (
                <Text
                  style={{ color: tokens.color.sub, fontSize: 11, fontFamily: font.mono }}
                >{`roll ${s.rollNo}`}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      {query.trim().length > 0 && matches.length === 0 && (
        <View style={dropSheet}>
          <Text
            testID={`${testID}-empty`}
            style={{
              color: tokens.color.sub,
              fontSize: 13,
              paddingVertical: 11,
              paddingHorizontal: 12,
            }}
          >
            No one in this class matches “{query.trim()}”.
          </Text>
        </View>
      )}

      {quickPhrases && quickPhrases.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {quickPhrases.map((phrase, i) => (
            <Pressable
              key={phrase}
              testID={`${testID}-quick-${i}`}
              accessibilityRole="button"
              onPress={() => onQuickPhrase?.(phrase)}
              style={({ pressed }) => ({
                backgroundColor: pressed ? tokens.color.indigo50 : tokens.color.surfaceMuted,
                borderColor: tokens.color.line,
                borderWidth: 1,
                borderRadius: tokens.radius.chip,
                paddingVertical: 5,
                paddingHorizontal: 10,
              })}
            >
              <Text style={{ color: tokens.color.ink2, fontSize: 11.5, fontWeight: '700' }}>
                {phrase}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
