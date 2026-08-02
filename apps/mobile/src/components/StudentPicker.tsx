import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTokens } from '@/theme/theme-context';

export interface PickableStudent {
  id: string;
  name: string;
  rollNo?: string | null;
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
 */
export function StudentPicker({
  students,
  selected,
  onChange,
  placeholder = 'Type a name…',
  testID = 'student-picker',
}: {
  students: PickableStudent[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  testID?: string;
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

  return (
    <View testID={testID} style={{ gap: 8 }}>
      {selected.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {selected.map((id) => (
            <Pressable
              key={id}
              testID={`token-${id}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${byId.get(id)?.name ?? 'student'}`}
              onPress={() => remove(id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: tokens.color.indigo50,
                borderRadius: tokens.radius.chip,
                paddingVertical: 6,
                paddingHorizontal: 11,
              }}
            >
              <Text style={{ color: tokens.color.indigo, fontSize: 12.5, fontWeight: '700' }}>
                {byId.get(id)?.name ?? 'Student'}
              </Text>
              <Text style={{ color: tokens.color.indigo, fontSize: 13, fontWeight: '700' }}>×</Text>
            </Pressable>
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
          borderColor: tokens.color.line,
          borderWidth: 1.5,
          borderRadius: 13,
          paddingVertical: 11,
          paddingHorizontal: 13,
          fontSize: 14.5,
          color: tokens.color.ink,
        }}
      />

      {matches.length > 0 && (
        <View
          testID={`${testID}-matches`}
          style={{
            backgroundColor: tokens.color.surface,
            borderColor: tokens.color.line,
            borderWidth: 1,
            borderRadius: 13,
            overflow: 'hidden',
          }}
        >
          {matches.map((s, i) => (
            <Pressable
              key={s.id}
              testID={`match-${s.id}`}
              accessibilityRole="button"
              onPress={() => add(s.id)}
              style={({ pressed }) => ({
                paddingVertical: 11,
                paddingHorizontal: 13,
                backgroundColor: pressed ? tokens.color.surfaceMuted : tokens.color.surface,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: tokens.color.line,
              })}
            >
              <Text style={{ color: tokens.color.ink, fontSize: 13.5, fontWeight: '600' }}>
                {s.name}
                {s.rollNo ? (
                  <Text style={{ color: tokens.color.sub, fontWeight: '500' }}>{`  ·  Roll ${s.rollNo}`}</Text>
                ) : null}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {query.trim().length > 0 && matches.length === 0 && (
        <Text testID={`${testID}-empty`} style={{ color: tokens.color.sub, fontSize: 12, marginLeft: 4 }}>
          No one in this class matches “{query.trim()}”.
        </Text>
      )}
    </View>
  );
}
