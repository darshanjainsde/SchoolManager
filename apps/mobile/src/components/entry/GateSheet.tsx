import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OpenDoorsScene } from './OpenDoorsScene';
import { SckoolsLogo } from '@/components/SckoolsLogo';
import { Icon, type IconName } from '@/components/icons';
import { useTheme } from '@/theme/theme-context';
import { brand, type GatePalette } from '@/theme/tokens';

/**
 * THE GATE SHEET — the front-door card the login screen sits in, for every
 * other screen outside the app (user, 9 Oct 2026: "fix the forgot password
 * screen too with our latest ui"). The reset screen was still the old
 * full-bleed indigo gradient with a centred serif title: the one screen on the
 * way in that looked like a different app.
 *
 * Same room as login: the Open Doors scene on the gate ground, an r24 card
 * docked to the bottom (thumb zone, keyboard pushes it up), the logo row —
 * with a 44 dp round back button when the screen is a step off login — then
 * an optional 56 dp tinted glyph, the title 22/700 and one line under it.
 */
export function GateSheet({
  title,
  subtitle,
  icon,
  tone = 'brand',
  onBack,
  backTestID = 'gate-back',
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  tone?: 'brand' | 'good' | 'warn';
  onBack?: () => void;
  backTestID?: string;
  children: ReactNode;
}) {
  const { scheme, tokens } = useTheme();
  const c = tokens.color;
  const dark = scheme === 'dark';
  const g: GatePalette = dark ? brand.gate.dark : brand.gate.light;
  const insets = useSafeAreaInsets();
  const glyph = {
    brand: { ink: c.indigo, soft: c.indigo50 },
    good: { ink: c.green, soft: c.green50 },
    warn: { ink: c.late, soft: c.amber50 },
  }[tone];

  return (
    <View style={{ flex: 1, backgroundColor: g.bgBottom }}>
      <OpenDoorsScene />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', padding: 14 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
          <View
            testID="gate-sheet"
            style={{
              backgroundColor: g.sheetFill,
              borderWidth: 1,
              borderColor: g.sheetBorder,
              borderRadius: 24,
              padding: 20,
              gap: 16,
              marginBottom: Math.max(insets.bottom, 6),
              shadowColor: brand.hero.shadow,
              shadowOpacity: 0.28,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 14 },
              elevation: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {onBack ? (
                <Pressable
                  testID={backTestID}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  onPress={onBack}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed ? c.indigo50 : c.appBg,
                  })}
                >
                  <Icon name="chevron" size={22} color={c.ink} />
                </Pressable>
              ) : null}
              <SckoolsLogo size={22} theme={dark ? 'dark' : 'light'} />
            </View>
            {icon ? (
              <View
                testID="gate-icon"
                style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: glyph.soft, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name={icon} size={28} color={glyph.ink} fillOpacity={0.2} />
              </View>
            ) : null}
            <View style={{ gap: 4 }}>
              <Text accessibilityRole="header" style={{ fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2, color: c.ink }}>
                {title}
              </Text>
              {subtitle ? <Text style={{ fontSize: 14, lineHeight: 20, color: c.sub }}>{subtitle}</Text> : null}
            </View>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
