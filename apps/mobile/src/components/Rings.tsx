import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTokens } from '@/theme/theme-context';

/**
 * Two concentric rings — never three. Each ring means one thing and is named
 * in the legend beside it; colour never carries the fact on its own.
 *   teacher / office: outer green = taught, inner indigo = expected by today
 *   child:            outer green = taught, inner blue = revised by me
 * The number in the middle is ink, not the ring colour.
 */
export interface RingSpec {
  pct: number;
  color: string;
  label: string;
}

export function Rings({ outer, inner, size = 88, stroke = 10, centre, testID }: {
  outer: RingSpec;
  inner: RingSpec;
  size?: number;
  stroke?: number;
  centre?: string;
  testID?: string;
}) {
  const tokens = useTokens();
  const c = size / 2;
  const rOut = c - stroke / 2;
  const rIn = rOut - stroke - 3;
  const dash = (r: number, pct: number) => {
    const len = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, pct));
    return `${(len * p) / 100} ${len}`;
  };
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={`${outer.label} ${outer.pct}%, ${inner.label} ${inner.pct}%`}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={c} cy={c} r={rOut} stroke={tokens.color.line} strokeWidth={stroke} fill="none" />
        <Circle cx={c} cy={c} r={rIn} stroke={tokens.color.line} strokeWidth={stroke} fill="none" />
        <Circle cx={c} cy={c} r={rOut} stroke={outer.color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={dash(rOut, outer.pct)} />
        <Circle cx={c} cy={c} r={rIn} stroke={inner.color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={dash(rIn, inner.pct)} />
      </Svg>
      {centre !== undefined && (
        <Text style={{ fontVariant: ['tabular-nums'], fontWeight: '700', fontSize: size >= 80 ? 16 : 12, color: tokens.color.ink }}>{centre}</Text>
      )}
    </View>
  );
}

export function RingLegend({ outer, inner }: { outer: RingSpec; inner: RingSpec }) {
  const tokens = useTokens();
  return (
    <View style={{ gap: 6, minWidth: 0, flex: 1 }}>
      {[outer, inner].map((r) => (
        <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: r.color }} />
          <Text style={{ flex: 1, fontSize: 13, color: tokens.color.sub }}>{r.label}</Text>
          <Text style={{ fontVariant: ['tabular-nums'], fontWeight: '700', fontSize: 13, color: tokens.color.ink }}>{`${r.pct}%`}</Text>
        </View>
      ))}
    </View>
  );
}
