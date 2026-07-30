import { Pressable, Text, View } from 'react-native';
import { useTheme, type ThemePreference } from '@/theme/theme-context';

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * "Appearance" row for the More screens (staff + family) — the app-wide
 * equivalent of the web portal's light/dark toggle. Segmented System / Light
 * / Dark control; the choice is persisted (see ThemeProvider) and applied
 * immediately app-wide via context, not just on this screen.
 */
export function AppearanceSetting() {
  const { tokens, preference, setPreference } = useTheme();
  return (
    <View style={{ paddingVertical: 10, paddingHorizontal: 10, gap: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>Appearance</Text>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: tokens.color.surfaceMuted,
          borderRadius: 10,
          padding: 3,
        }}
      >
        {OPTIONS.map((opt) => {
          const on = preference === opt.value;
          return (
            <Pressable
              key={opt.value}
              testID={`appearance-${opt.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setPreference(opt.value)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: on ? tokens.color.indigo : 'transparent',
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '700',
                  color: on ? tokens.color.onBrand : tokens.color.sub,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
