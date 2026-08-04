import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useTokens } from '@/theme/theme-context';
import { brand, font } from '@/theme/tokens';
import { DASH, DUR, EASE, useReduceMotion } from '@/theme/motion';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedG = Animated.createAnimatedComponent(View);

type Props = {
  size?: number;
  variant?: 'full' | 'symbol';
  /**
   * Which background this logo sits on (e.g. "dark" for the indigo hero in
   * AuthScaffold) — independent of the app's own light/dark colour scheme,
   * which the caller does not control from here.
   */
  theme?: 'light' | 'dark';
  /**
   * Draw the mark on mount, as a pen would: the S strokes itself in, the
   * tassel cord follows, the bead pops on the end (the pitch's `pendraw` +
   * `beadpop`). Reserved for moments the logo is the subject — the splash and
   * the auth hero — because a mark that redraws itself on every screen stops
   * reading as ink and starts reading as a loading state.
   */
  draw?: boolean;
  /**
   * Swing the tassel on a slow loop once drawn (the pitch's `tswing`). The
   * amber cord and bead ARE the "!" in Sckools, so this is the mark being
   * itself, not decoration.
   */
  swing?: boolean;
};

export function SckoolsLogo({
  size = 32,
  variant = 'full',
  theme = 'light',
  draw = false,
  swing = false,
}: Props) {
  const tokens = useTokens();
  const stroke = theme === 'dark' ? tokens.color.indigoDark : tokens.color.indigo;
  const tassel = theme === 'dark' ? tokens.color.amberDark : tokens.color.amber;
  const text = theme === 'dark' ? brand.onHero : tokens.color.ink;
  const reduced = useReduceMotion();

  // 0 → 1 across the whole draw: the S owns the first stretch, the cord the
  // next, the bead the last. One value drives all three so the sequence can
  // never desynchronise.
  const pen = useRef(new Animated.Value(draw ? 0 : 1)).current;
  const wag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!draw) return;
    if (reduced.current) {
      pen.setValue(1);
      return;
    }
    Animated.timing(pen, {
      toValue: 1,
      duration: DUR.logo + 500, // the S, then the cord, then the bead
      easing: EASE,
      useNativeDriver: false, // strokeDashoffset is not a transform
    }).start();
  }, [draw, pen, reduced]);

  useEffect(() => {
    if (!swing || reduced.current) return;
    // A pause, a swing, a long pause — the rhythm of something knocked and
    // left to settle, not a metronome.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(2000),
        Animated.timing(wag, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(wag, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [swing, wag, reduced]);

  // The pitch's keyframes, expressed as slices of the single `pen` value.
  const sOffset = pen.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [DASH.logoS, 0, 0],
  });
  const cordOffset = pen.interpolate({
    inputRange: [0, 0.65, 0.85, 1],
    outputRange: [DASH.logoTassel, DASH.logoTassel, 0, 0],
  });
  const beadScale = pen.interpolate({
    inputRange: [0, 0.82, 0.93, 1],
    outputRange: [0, 0, 1.35, 1], // `beadpop`'s overshoot
  });
  const rotate = wag.interpolate({
    inputRange: [0, 0.12, 0.24, 0.36, 0.48, 1],
    outputRange: ['0deg', '-14deg', '10deg', '-5deg', '0deg', '0deg'],
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox="0 0 52 52">
          <AnimatedPath
            d="M34 14 C34 8.5 25 7.5 19.3 10 C12 13 13.7 19 23.5 21.4 C33.5 24 35.2 29.7 29.3 33.4 C23.6 37 14.6 35.6 13.6 29.4"
            fill="none"
            stroke={stroke}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={DASH.logoS}
            strokeDashoffset={draw ? (sOffset as unknown as number) : 0}
          />
        </Svg>
        {/* The tassel rides in its own layer so it can swing about the point
            where the cord meets the S, which an SVG transform-origin inside
            react-native-svg cannot express as cleanly. */}
        <AnimatedG
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size,
            height: size,
            transform: [
              { translateX: (41 / 52) * size },
              { translateY: (9 / 52) * size },
              { rotate },
              { translateX: -(41 / 52) * size },
              { translateY: -(9 / 52) * size },
            ],
          }}
        >
          <Svg width={size} height={size} viewBox="0 0 52 52">
            <AnimatedLine
              x1={41}
              y1={9}
              x2={41}
              y2={19}
              stroke={tassel}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray={DASH.logoTassel}
              strokeDashoffset={draw ? (cordOffset as unknown as number) : 0}
            />
          </Svg>
          <Animated.View
            style={{
              position: 'absolute',
              left: (38 / 52) * size,
              top: (19 / 52) * size,
              width: (6 / 52) * size,
              height: (6 / 52) * size,
              borderRadius: (3 / 52) * size,
              backgroundColor: tassel,
              transform: [{ scale: draw ? beadScale : 1 }],
            }}
          />
        </AnimatedG>
      </View>
      {variant === 'full' && (
        <Text
          style={{
            fontWeight: '800',
            letterSpacing: -0.5,
            fontSize: size * 0.62,
            color: text,
            fontFamily: font.sans,
          }}
        >
          Sckools
        </Text>
      )}
    </View>
  );
}
