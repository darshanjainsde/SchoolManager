import { Pressable, Text, View } from 'react-native';
import { tokens } from '@/theme/tokens';

interface ClassRef {
  classSectionId: string;
  name: string;
}

/**
 * Multi-select chips for "which class(es)" pickers (Post screen). Each chip
 * toggles independently — tapping one never clears the others. P1 has no
 * whole-school chip for teachers (server-enforced: teachers may only target
 * their own classes), so this only ever renders the caller's own classes.
 */
export function ClassChips({
  classes,
  selected,
  onChange,
}: {
  classes: ClassRef[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {classes.map((c) => {
        const on = selected.includes(c.classSectionId);
        return (
          <Pressable
            key={c.classSectionId}
            onPress={() => toggle(c.classSectionId)}
            style={{
              borderWidth: 1.5,
              borderColor: on ? tokens.color.indigo : tokens.color.line,
              backgroundColor: on ? tokens.color.indigo50 : tokens.color.surface,
              borderRadius: 11,
              paddingVertical: 9,
              paddingHorizontal: 13,
            }}
          >
            <Text
              style={{
                fontSize: 12.5,
                fontWeight: '700',
                color: on ? tokens.color.indigo : tokens.color.sub,
              }}
            >
              {on ? `✓ ${c.name}` : c.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
