import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { brand } from '@/theme/tokens';
import { useTheme, useTokens } from '@/theme/theme-context';
import { bandRings } from '@/theme/families';
import { Touchable } from './Touchable';

/** One figure on the band: what it is, how full the ring is, where a tap goes. */
export interface BandMetric {
  /** The figure inside the ring, already formatted ("3/4", "92%"). */
  value: string;
  /** How full the ring is, 0–100. */
  pct: number;
  /** One or two short words under the ring. */
  label: string;
  /** What a screen reader says; defaults to "label: value". */
  accessibilityLabel?: string;
  onPress?: () => void;
  testID?: string;
}

/** How much taller a band grows to hold the rings row (sckools-ui-standards §3d). */
export const RINGS_HEIGHT = 132;
const SIZE = 74;
const STROKE = 8;

/**
 * THE REPORT CARD ON THE BAND (user, 18 Oct 2026: "Report card — this one I
 * like … few dashboard matrices on the top panel"). Up to three of the day's
 * figures, each a ring in its own chalk colour (theme/families.ts bandRings)
 * on the school's deepest shade, the figure white inside it. A ring is a door:
 * it opens the screen its figure comes from.
 */
export function BandRings({ metrics, testID = 'band-rings' }: { metrics: BandMetric[]; testID?: string }) {
  const tokens = useTokens();
  const { scheme } = useTheme();
  const colours = bandRings(tokens.color, scheme);
  const r = (SIZE - STROKE) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <View testID={testID} style={{ flexDirection: 'row', marginTop: 18, height: RINGS_HEIGHT - 18 }}>
      {metrics.slice(0, 3).map((m, i) => {
        const pct = Math.max(0, Math.min(100, Number.isFinite(m.pct) ? m.pct : 0));
        const body = (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={brand.onHero} strokeOpacity={0.16} strokeWidth={STROKE} fill="none" />
                {pct > 0 && (
                  <Circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={r}
                    stroke={colours[i]}
                    strokeWidth={STROKE}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * circ} ${circ}`}
                  />
                )}
              </Svg>
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ fontSize: 17, fontWeight: '700', color: brand.onHero, fontVariant: ['tabular-nums'], maxWidth: SIZE - STROKE * 2 - 10 }}
              >
                {m.value}
              </Text>
            </View>
            <Text
              maxFontSizeMultiplier={1.25}
              numberOfLines={2}
              style={{ fontSize: 12, lineHeight: 15, textAlign: 'center', color: brand.onHero, opacity: 0.88 }}
            >
              {m.label}
            </Text>
          </View>
        );
        const a11y = m.accessibilityLabel ?? `${m.label}: ${m.value}`;
        // Each ring owns an exact third of the row, centred in it: the column is a
        // plain View, because Touchable puts its style on an inner view and its
        // outer box shrank to its label (audit 18 Oct 2026: ring centres 115 dp
        // then 149 dp apart).
        return (
          <View key={m.label} style={{ flex: 1, alignItems: 'center' }}>
            {m.onPress ? (
              <Touchable testID={m.testID} onPress={m.onPress} accessibilityRole="button" accessibilityLabel={a11y} style={{ minHeight: 48, minWidth: 96 }}>
                {body}
              </Touchable>
            ) : (
              <View testID={m.testID} accessible accessibilityLabel={a11y} style={{ minWidth: 96 }}>
                {body}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
