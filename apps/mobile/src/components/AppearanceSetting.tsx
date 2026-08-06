import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme, type ThemePreference } from '@/theme/theme-context';
import { GROUNDS, GROUND_NAMES, PAPER_PATTERNS } from '@/theme/grounds';
import { ACCENTS, ACCENT_NAMES } from '@/theme/accents';

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * "Appearance" block for the Settings screen — light/dark, and the three
 * choices that decide what the app looks like: highlight, paper, ruling.
 *
 * The highlight defaults to **My school**, so an app looks like the place a
 * person actually goes unless they say otherwise. Choosing a named colour is an
 * opt-out rather than the starting point, and it is a real one: the choice then
 * holds in dark mode too, where a school's own brand deliberately does not
 * apply (a colour picked against a white website can fail badly on near-black).
 *
 * Every choice persists (see ThemeProvider) and applies immediately app-wide
 * through context, not just on this screen.
 */
export function AppearanceSetting() {
  const { tokens, preference, setPreference, ground, setGround, pattern, setPattern, accent, setAccent } =
    useTheme();

  const label = { fontSize: 13, fontWeight: '600' as const, color: tokens.color.ink };
  const hint = { fontSize: 11, color: tokens.color.sub, marginTop: -4 };

  return (
    <View style={{ paddingVertical: 10, paddingHorizontal: 10, gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Text style={label}>Appearance</Text>
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

      <View style={{ gap: 8 }}>
        <Text style={label}>Highlight</Text>
        <Text style={hint}>Buttons, active tabs and the card at the top.</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingVertical: 2, paddingRight: 10 }}
        >
          {ACCENT_NAMES.map((name) => {
            const a = ACCENTS[name];
            const on = accent === name;
            // 'My school' has no colour of its own to show, so it wears the one
            // currently in force — which IS the school's, and makes the option
            // demonstrate itself rather than describe itself.
            const swatch = a.light?.fill ?? tokens.color.indigo;
            return (
              <Pressable
                key={name}
                testID={`accent-${name}`}
                accessibilityRole="button"
                accessibilityLabel={`${a.label} — ${a.hint}`}
                accessibilityState={{ selected: on }}
                onPress={() => setAccent(name)}
                style={{ alignItems: 'center', gap: 5, width: 64 }}
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 23,
                    backgroundColor: swatch,
                    borderWidth: on ? 3 : 1,
                    borderColor: on ? tokens.color.ink : tokens.color.line2,
                  }}
                />
                <Text
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.3}
                  style={{
                    fontSize: 10,
                    lineHeight: 12,
                    textAlign: 'center',
                    color: on ? tokens.color.ink : tokens.color.sub,
                    fontWeight: on ? '700' : '500',
                  }}
                >
                  {a.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={label}>Paper</Text>
        <Text style={hint}>The shade the app is printed on.</Text>
        {/* Horizontal rather than a grid: seven swatches would either wrap into
            a ragged block or force each one too small to judge a shade by. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingVertical: 2, paddingRight: 10 }}
        >
          {GROUND_NAMES.map((name) => {
            const g = GROUNDS[name];
            const on = ground === name;
            return (
              <Pressable
                key={name}
                testID={`ground-${name}`}
                accessibilityRole="button"
                accessibilityLabel={`${g.label} — ${g.hint}`}
                accessibilityState={{ selected: on }}
                onPress={() => setGround(name)}
                style={{ alignItems: 'center', gap: 5, width: 64 }}
              >
                {/* The swatch shows the ground WITH its card on top, because a
                    ground is a relationship between the two — a flat square of
                    the page colour tells you nothing about how it will read. */}
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 12,
                    backgroundColor: g.light.appBg,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? tokens.color.indigo : tokens.color.line2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <View
                    style={{
                      width: 26,
                      height: 20,
                      borderRadius: 5,
                      backgroundColor: g.light.surface,
                      borderWidth: 1,
                      borderColor: g.light.line,
                    }}
                  />
                </View>
                <Text
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.3}
                  style={{
                    fontSize: 10,
                    lineHeight: 12,
                    textAlign: 'center',
                    color: on ? tokens.color.ink : tokens.color.sub,
                    fontWeight: on ? '700' : '500',
                  }}
                >
                  {g.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={label}>Ruling</Text>
        <Text style={hint}>Faint lines behind the page, like an exercise book.</Text>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: tokens.color.surfaceMuted,
            borderRadius: 10,
            padding: 3,
          }}
        >
          {PAPER_PATTERNS.map((p) => {
            const on = pattern === p.value;
            return (
              <Pressable
                key={p.value}
                testID={`pattern-${p.value}`}
                accessibilityRole="button"
                accessibilityLabel={`${p.label} — ${p.hint}`}
                accessibilityState={{ selected: on }}
                onPress={() => setPattern(p.value)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: on ? tokens.color.indigo : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: on ? tokens.color.onBrand : tokens.color.sub,
                  }}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
