import { Animated, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Stop } from 'react-native-svg';
import { brand } from '@/theme/tokens';
import { useTheme, useTokens } from '@/theme/theme-context';
import { bandRings, ringSheen } from '@/theme/families';
import { useGesture } from '@/theme/motion';
import { Touchable } from './Touchable';
import { Icon } from './icons';

/** One figure on the band: what it is, how full its ring is, where a tap goes. */
export interface BandMetric {
  /** The figure, already formatted ("3/4", "92%", "None"). */
  value: string;
  /** How full the ring is, 0–100. */
  pct: number;
  /** One or two short words naming the figure. */
  label: string;
  /** What a screen reader says; defaults to "label: value". */
  accessibilityLabel?: string;
  onPress?: () => void;
  testID?: string;
}

/**
 * The ring stack's geometry (sckools-ui-standards §3d), after Apple's
 * Activity rings: three CONCENTRIC rings, equal stroke, a 3 dp gap, so the
 * three of them read as one object — one day — rather than three gauges.
 */
const SIZE = 128;
const STROKE = 15;
const GAP = 3;
const TOP = 20;
/** How much taller a band grows to hold the rings row. */
export const RINGS_HEIGHT = TOP + SIZE + 8;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * THE DAY'S RINGS ON THE BAND (user, 19 Oct 2026: "make the rings more
 * perfect — take inspiration from Apple ring perfection", and say the figure
 * somewhere other than inside the ring).
 *
 * Left: three concentric rings, each in its own chalk colour picked against
 * the school's band (theme/families.ts bandRings), drawn on a track of the
 * same colour at 22 %, with a round cap and a quiet sheen along the stroke.
 * They draw themselves on once, when the day's figures arrive (Reduce Motion
 * → final state). A ring at 0 still shows its cap as a dot, so every ring is
 * findable even on an empty day.
 *
 * Right: the legend IS the figures — label over value, the value written in
 * its ring's own colour, so the eye pairs them without a key. A figure with
 * somewhere to go is a 48 dp row with a chevron that opens it.
 */
export function BandRings({ metrics, testID = 'band-rings' }: { metrics: BandMetric[]; testID?: string }) {
  const tokens = useTokens();
  const { scheme } = useTheme();
  const colours = bandRings(tokens.color, scheme);
  const shown = metrics.slice(0, 3);
  // Draw on once, the first time real figures are in (a loading pass has no values).
  const ready = shown.some((m) => m.value !== '');
  const drawn = useGesture(ready, 1100, { native: false, delay: 120 });

  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', marginTop: TOP, height: SIZE, gap: 20 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Defs>
            {shown.map((_, i) => (
              // The sheen: the stroke runs from a slightly deeper shade at the
              // start of the lap to the pure colour at its end, as Apple's do.
              <LinearGradient key={i} id={`ring-${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colours[i]} />
                <Stop offset="1" stopColor={ringSheen(colours[i])} />
              </LinearGradient>
            ))}
          </Defs>
          {shown.map((m, i) => {
            const r = SIZE / 2 - STROKE / 2 - i * (STROKE + GAP);
            const circ = 2 * Math.PI * r;
            const pct = Math.max(0, Math.min(100, Number.isFinite(m.pct) ? m.pct : 0));
            const len = (pct / 100) * circ;
            return (
              <G key={m.label}>
                <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={colours[i]} strokeOpacity={0.22} strokeWidth={STROKE} fill="none" />
                {/* The cap at the start of the lap: a dot even at 0 %. */}
                <Circle cx={SIZE / 2 + r} cy={SIZE / 2} r={STROKE / 2} fill={colours[i]} />
                {len > 0 && (
                  <AnimatedCircle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={r}
                    stroke={`url(#ring-${i})`}
                    strokeWidth={STROKE}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${circ} ${circ}`}
                    strokeDashoffset={drawn.interpolate({ inputRange: [0, 1], outputRange: [circ, circ - len] })}
                  />
                )}
              </G>
            );
          })}
        </Svg>
      </View>

      <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
        {shown.map((m, i) => {
          const a11y = m.accessibilityLabel ?? `${m.label}: ${m.value}`;
          const body = (
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 42 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={{ fontSize: 12, lineHeight: 15, fontWeight: '600', color: brand.onHero, opacity: 0.86 }}>
                  {m.label}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  style={{ fontSize: 20, lineHeight: 25, fontWeight: '700', color: colours[i], fontVariant: ['tabular-nums'], letterSpacing: -0.2 }}
                >
                  {m.value}
                </Text>
              </View>
              {m.onPress ? <Icon name="chevron" size={16} color={brand.onHero} /> : null}
            </View>
          );
          return m.onPress ? (
            <Touchable key={m.label} testID={m.testID} onPress={m.onPress} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={3}>
              {body}
            </Touchable>
          ) : (
            <View key={m.label} testID={m.testID} accessible accessibilityLabel={a11y}>
              {body}
            </View>
          );
        })}
      </View>
    </View>
  );
}
