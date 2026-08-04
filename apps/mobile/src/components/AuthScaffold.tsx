import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop, Circle } from 'react-native-svg';
import { SckoolsLogo } from '@/components/SckoolsLogo';
import { useTokens } from '@/theme/theme-context';
import { brand, font } from '@/theme/tokens';

/**
 * Branded auth scaffold shared by the Connect + Login screens.
 * Indigo brand gradient hero with a floating white form card, and a staggered
 * entrance animation (logo springs in, then the card fades/slides up). Uses
 * react-native's built-in Animated (no extra native deps) and react-native-svg
 * for the gradient (already a dependency).
 */
export function AuthScaffold({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const tokens = useTokens();
  const { width, height } = Dimensions.get('window');
  const slide = useRef(new Animated.Value(28)).current;
  const logoScale = useRef(new Animated.Value(0.82)).current;
  const logoFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Logo fades + springs in (non-interactive, safe to fade). The form block
    // only SLIDES up (opacity stays 1) so its inputs/button are always visible
    // and tappable — a fade-from-0 there can stall on slow devices and leave
    // the primary button briefly untappable.
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoFade, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      ]),
      Animated.spring(slide, { toValue: 0, friction: 9, tension: 70, useNativeDriver: true }),
    ]).start();
  }, [slide, logoScale, logoFade]);

  return (
    <View style={{ flex: 1, backgroundColor: brand.authGradientEnd }}>
      <Svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <LinearGradient id="authbg" x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor={brand.authGradientStart} />
            <Stop offset="0.55" stopColor={brand.authGradientMid} />
            <Stop offset="1" stopColor={brand.authGradientEnd} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#authbg)" />
        {/* soft amber brand glow, top-right */}
        <Circle cx={width * 0.9} cy={height * 0.12} r={width * 0.42} fill={brand.authGlowAmber} opacity={0.12} />
        <Circle cx={width * 0.12} cy={height * 0.9} r={width * 0.5} fill={brand.authGlowIndigo} opacity={0.18} />
      </Svg>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: 24 }}
      >
        <Animated.View
          style={{ alignItems: 'center', marginBottom: 30, opacity: logoFade, transform: [{ scale: logoScale }] }}
        >
          {/* The pitch's splash: "the S draws itself · the tassel is the '!'".
              This is the one screen where the mark is the subject rather than
              a header ornament, so it gets the full pen-draw and then keeps
              the slow tassel swing while the person types. */}
          <SckoolsLogo size={54} theme="dark" draw swing />
        </Animated.View>

        <Animated.View style={{ transform: [{ translateY: slide }] }}>
          <Text
            style={{
              color: brand.onHero,
              fontFamily: font.serif,
              fontSize: 27,
              fontWeight: '600',
              letterSpacing: -0.3,
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={{
                color: 'rgba(255,255,255,0.78)',
                fontSize: 15,
                lineHeight: 21,
                textAlign: 'center',
                marginTop: 10,
                paddingHorizontal: 8,
              }}
            >
              {subtitle}
            </Text>
          ) : null}

          <View
            style={{
              backgroundColor: tokens.color.surface,
              borderRadius: 22,
              padding: 20,
              marginTop: 26,
              gap: 14,
              shadowColor: brand.authCardShadow,
              shadowOpacity: 0.25,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
              elevation: 10,
            }}
          >
            {children}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── The gate's form vocabulary (`.fld`, `.savebtn`, `.linkish`, `.gatesub`,
//    `.resetok`) ────────────────────────────────────────────────────────────
// Shared by all three auth screens so the first thing anyone sees of this app
// is drawn once. They live beside the scaffold rather than in components/ui
// because nothing behind the gate uses them: inside the app a field sits on a
// diary page, here it sits on the card that stands in front of one.
//
// Sizes come from the pitch's own auth block (`.fld input{font-size:14px;
// padding:11px 13px}`, radius 11, a 1.5px rule border) — that block is already
// drawn at something close to device scale, unlike the pitch's rail rows. The
// one number lifted upward is the button label: the pitch's 12.5px is a phone
// MOCK's caption size and would be uncomfortably small as the primary control
// on a real handset.

/**
 * `.fld` — a labelled field.
 *
 * The label is UPPERCASE, tracked and dim above the input rather than a
 * placeholder inside it, because a placeholder disappears the moment someone
 * starts typing and these are the two or three facts a person is most likely to
 * mistype. Tracked small-caps is also the register-book way to head a column,
 * which is the voice this whole app is written in.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const tokens = useTokens();
  return (
    <View style={{ gap: 5 }}>
      <Text
        style={{
          fontSize: 10,
          fontWeight: '800',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: tokens.color.sub,
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

/**
 * The `.fld input` style: paper fill, a 1.5px pencil rule that turns ACCENT on
 * focus (the pitch's only focus signal — no glow, no shadow, the rule is simply
 * inked in), radius 11.
 *
 * `mono` sets the field in the figure face with wide tracking, for a value that
 * is read and typed CHARACTER BY CHARACTER rather than as a word: a student
 * code like RAF-00042 is checked digit against digit off a printed letter, and
 * proportional type makes that check harder than it needs to be.
 */
export function fieldInputStyle(
  tokens: { color: { appBg: string; indigo: string; line: string; ink: string } },
  opts: { focused?: boolean; mono?: boolean } = {},
): TextStyle {
  return {
    backgroundColor: tokens.color.appBg,
    borderColor: opts.focused ? tokens.color.indigo : tokens.color.line,
    borderWidth: 1.5,
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 13,
    color: tokens.color.ink,
    ...(opts.mono
      ? { fontFamily: font.mono, fontSize: 15, letterSpacing: 1.5 }
      : { fontSize: 14.5 }),
  };
}

/**
 * `.savebtn` — the one thing this screen is for, full width, in the accent.
 *
 * `.press` is the pitch's tap acknowledgement (`transform:scale(.965)`): the
 * button visibly gives under the finger, which is what stops a second tap while
 * a request is in flight. It is a touch-tracking transform, not an animation
 * that plays on its own, so there is no reduce-motion case to honour — it lasts
 * exactly as long as the finger is down.
 */
export function AuthButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const tokens = useTokens();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: tokens.color.indigo,
        borderRadius: 11,
        paddingVertical: 14,
        opacity: disabled ? 0.45 : 1,
        transform: [{ scale: pressed && !disabled ? 0.965 : 1 }],
      })}
    >
      <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center', fontSize: 15 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * `.quickfill` / `.linkish` — the pitch's two flavours of bare link: a small
 * bold ACCENT word (the way out of this screen) or the same shape in meta grey
 * (the way back to the last one). Both are text, never a second button: a
 * screen with two filled buttons has no primary action.
 */
export function AuthLink({
  label,
  onPress,
  tone = 'accent',
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'muted';
  testID?: string;
}) {
  const tokens = useTokens();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="link"
      hitSlop={8}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.965 : 1 }] })}
    >
      <Text
        style={{
          color: tone === 'accent' ? tokens.color.indigo : tokens.color.sub,
          fontWeight: '700',
          textAlign: 'center',
          fontSize: 12.5,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * `.gatesub` — the small grey line that explains a field without shouting. Sits
 * UNDER the input it belongs to, so it reads as a footnote to that field rather
 * than as instructions to the whole screen (the scaffold's own subtitle already
 * does that job, up on the hero).
 */
export function AuthNote({ children }: { children: ReactNode }) {
  const tokens = useTokens();
  return (
    <Text style={{ fontSize: 11.5, lineHeight: 16, color: tokens.color.sub, marginTop: -4 }}>{children}</Text>
  );
}

/**
 * `.resetok` — the outcome slip: a tinted panel OUTLINED in its own ink
 * (`border:1.5px solid`, radius 11) rather than a floating toast, because this
 * one is the whole answer to the question the screen asked and it has to stay
 * on the page while the person goes to check their inbox.
 *
 * Two tones, exactly as the pitch uses them: `good` for "the link is on its
 * way", `warn` (amber) for the honest not-quite-success — the code was fine but
 * there is no email on file, so nothing was sent. That second case must never
 * be dressed in the green of the first.
 */
export function AuthSlip({
  tone,
  children,
  testID,
}: {
  tone: 'good' | 'warn';
  children: ReactNode;
  testID?: string;
}) {
  const tokens = useTokens();
  const fg = tone === 'good' ? tokens.color.green : tokens.color.late;
  const bg = tone === 'good' ? tokens.color.green50 : tokens.color.amber50;
  return (
    <View
      style={{
        borderWidth: 1.5,
        borderColor: tone === 'good' ? tokens.color.green : tokens.color.amber,
        backgroundColor: bg,
        borderRadius: 11,
        paddingVertical: 11,
        paddingHorizontal: 13,
      }}
    >
      <Text testID={testID} style={{ color: fg, fontSize: 13, lineHeight: 19, fontWeight: '600' }}>
        {children}
      </Text>
    </View>
  );
}
