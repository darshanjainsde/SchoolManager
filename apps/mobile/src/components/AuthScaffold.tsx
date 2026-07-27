import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Dimensions, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop, Circle } from 'react-native-svg';
import { SckoolsLogo } from '@/components/SckoolsLogo';

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
  const { width, height } = Dimensions.get('window');
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(28)).current;
  const logoScale = useRef(new Animated.Value(0.82)).current;
  const logoFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoFade, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.spring(slide, { toValue: 0, friction: 9, tension: 70, useNativeDriver: true }),
      ]),
    ]).start();
  }, [fade, slide, logoScale, logoFade]);

  return (
    <View style={{ flex: 1, backgroundColor: '#312E81' }}>
      <Svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <LinearGradient id="authbg" x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor="#6366F1" />
            <Stop offset="0.55" stopColor="#4F46E5" />
            <Stop offset="1" stopColor="#312E81" />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#authbg)" />
        {/* soft amber brand glow, top-right */}
        <Circle cx={width * 0.9} cy={height * 0.12} r={width * 0.42} fill="#F59E0B" opacity={0.12} />
        <Circle cx={width * 0.12} cy={height * 0.9} r={width * 0.5} fill="#818CF8" opacity={0.18} />
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

        <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
          <Text
            style={{
              color: '#FFFFFF',
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
              backgroundColor: '#FFFFFF',
              borderRadius: 22,
              padding: 20,
              marginTop: 26,
              gap: 14,
              shadowColor: '#1E1B4B',
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
