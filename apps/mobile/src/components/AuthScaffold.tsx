import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Dimensions, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop, Circle } from 'react-native-svg';
import { SckoolsLogo } from '@/components/SckoolsLogo';
import { useTokens } from '@/theme/theme-context';
import { brand } from '@/theme/tokens';

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
          <SckoolsLogo size={54} theme="dark" />
        </Animated.View>

        <Animated.View style={{ transform: [{ translateY: slide }] }}>
          <Text
            style={{
              color: brand.onHero,
              fontSize: 26,
              fontWeight: '800',
              letterSpacing: -0.5,
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
