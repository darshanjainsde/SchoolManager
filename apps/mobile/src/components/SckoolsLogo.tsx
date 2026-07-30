import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useTokens } from '@/theme/theme-context';
import { brand } from '@/theme/tokens';

type Props = {
  size?: number;
  variant?: 'full' | 'symbol';
  /**
   * Which background this logo sits on (e.g. "dark" for the indigo hero in
   * AuthScaffold) — independent of the app's own light/dark colour scheme,
   * which the caller does not control from here.
   */
  theme?: 'light' | 'dark';
};

export function SckoolsLogo({ size = 32, variant = 'full', theme = 'light' }: Props) {
  const tokens = useTokens();
  const stroke = theme === 'dark' ? tokens.color.indigoDark : tokens.color.indigo;
  const tassel = theme === 'dark' ? tokens.color.amberDark : tokens.color.amber;
  const text = theme === 'dark' ? brand.onHero : tokens.color.ink;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Svg width={size} height={size} viewBox="0 0 52 52">
        <Path
          d="M34 14 C34 8.5 25 7.5 19.3 10 C12 13 13.7 19 23.5 21.4 C33.5 24 35.2 29.7 29.3 33.4 C23.6 37 14.6 35.6 13.6 29.4"
          fill="none" stroke={stroke} strokeWidth={5} strokeLinecap="round"
        />
        <Line x1={41} y1={9} x2={41} y2={19} stroke={tassel} strokeWidth={2.4} strokeLinecap="round" />
        <Circle cx={41} cy={22} r={3} fill={tassel} />
      </Svg>
      {variant === 'full' && (
        <Text style={{ fontWeight: '800', letterSpacing: -0.5, fontSize: size * 0.62, color: text }}>
          Sckools
        </Text>
      )}
    </View>
  );
}
