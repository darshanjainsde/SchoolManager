import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme/theme-context';
import { deriveFamilies, type Family } from '@/theme/families';
import { useTokens } from '@/theme/theme-context';
import { ART } from '@/theme/illustration';

/**
 * PICTURES FOR THE MOMENTS A SCREEN WOULD OTHERWISE BE EMPTY (UI v2).
 *
 * Flat shapes in the icon-family colours, drawn as SVG: about 2 KB each, sharp
 * at any size, and they take the dark scheme with the rest of the app. Each
 * says what happened (all registers taken, nothing set for tomorrow) — the
 * way Google Pay and Duolingo mark a finished task with a picture rather than
 * a grey sentence. Decorative: hidden from screen readers; the words under
 * the picture carry the meaning.
 */
export type Scene = 'registersDone' | 'noHomework' | 'nothingOut' | 'feesPaid' | 'sportsDay' | 'holiday';

export function Illustration({ scene, height = 150, testID }: { scene: Scene; height?: number; testID?: string }) {
  // The testID sits on a plain wrapper: the picture itself is hidden from
  // screen readers, and a hidden node is hidden from tests too.
  return (
    <View testID={testID ?? `illustration-${scene}`} style={{ width: '100%' }}>
      <Picture scene={scene} height={height} />
    </View>
  );
}

function Picture({ scene, height }: { scene: Scene; height: number }) {
  const { scheme } = useTheme();
  const tokens = useTokens();
  const fam = deriveFamilies(tokens.color, scheme);
  const f = (k: Family) => fam[k];
  const white = scheme === 'dark' ? ART.paperDark : ART.white;
  const faint = scheme === 'dark' ? ART.faintDark : ART.faint;
  const common = {
    width: '100%' as const,
    height,
    viewBox: '0 0 280 170',
    accessible: false,
    importantForAccessibility: 'no-hide-descendants' as const,
  };

  switch (scene) {
    case 'registersDone':
      return (
        <Svg {...common}>
          <Rect x={0} y={0} width={280} height={170} rx={20} fill={f('learn').soft} />
          <Circle cx={52} cy={40} r={5} fill={ART.amber} />
          <Circle cx={226} cy={34} r={4} fill={ART.green} />
          <Rect x={210} y={118} width={10} height={10} rx={2} fill={ART.pink} transform="rotate(20 215 123)" />
          <Rect x={58} y={120} width={9} height={9} rx={2} fill={ART.blue} transform="rotate(-15 62 124)" />
          <Rect x={96} y={28} width={88} height={118} rx={12} fill={white} />
          <Rect x={120} y={20} width={40} height={16} rx={6} fill={f('learn').ink} />
          <Rect x={110} y={50} width={60} height={6} rx={3} fill={faint} />
          <Rect x={110} y={62} width={44} height={6} rx={3} fill={faint} />
          <Circle cx={140} cy={106} r={24} fill={f('sport').ink} />
          <Path d="M128 106l8 8 16-17" fill="none" stroke={ART.white} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'noHomework':
      return (
        <Svg {...common}>
          <Rect x={0} y={0} width={280} height={170} rx={20} fill={f('people').soft} />
          <Path d="M52 60 C 90 30, 130 40, 150 30" fill="none" stroke={f('people').ink} strokeWidth={2} strokeDasharray="4 6" strokeLinecap="round" />
          <Path d="M150 22l46 10-30 12z" fill={f('people').ink} />
          <Path d="M70 128 L 140 112 L 140 150 L 70 160 Z" fill={white} />
          <Path d="M210 128 L 140 112 L 140 150 L 210 160 Z" fill={white} opacity={0.85} />
          <Path d="M140 112 L 140 150" stroke={faint} strokeWidth={2} />
          <Circle cx={222} cy={52} r={14} fill={ART.sun} />
        </Svg>
      );
    case 'nothingOut':
      return (
        <Svg {...common}>
          <Rect x={0} y={0} width={280} height={170} rx={20} fill={f('sport').soft} />
          <Rect x={70} y={128} width={140} height={22} rx={5} fill={f('sport').ink} />
          <Rect x={82} y={104} width={120} height={24} rx={5} fill={f('learn').ink} />
          <Rect x={76} y={82} width={128} height={22} rx={5} fill={ART.amber} />
          <Rect x={90} y={60} width={104} height={22} rx={5} fill={f('money').ink} />
          <Path d="M176 60 v34 l8 -7 l8 7 v-34 z" fill={ART.rose} />
          <Circle cx={222} cy={44} r={6} fill={ART.green} />
        </Svg>
      );
    case 'feesPaid':
      return (
        <Svg {...common}>
          <Rect x={0} y={0} width={280} height={170} rx={20} fill={f('money').soft} />
          <Path d="M96 22 h88 v128 l-11 -7 l-11 7 l-11 -7 l-11 7 l-11 -7 l-11 7 l-11 -7 l-11 7 z" fill={white} />
          <Rect x={108} y={38} width={64} height={6} rx={3} fill={faint} />
          <Rect x={108} y={52} width={48} height={6} rx={3} fill={faint} />
          <G transform="rotate(-12 140 104)">
            <Rect x={104} y={88} width={72} height={32} rx={8} fill="none" stroke={f('sport').ink} strokeWidth={4} />
            <SvgText x={140} y={111} textAnchor="middle" fontSize={18} fontWeight="700" fill={f('sport').ink}>PAID</SvgText>
          </G>
          <Ellipse cx={212} cy={140} rx={20} ry={7} fill={ART.coinDark} />
          <Ellipse cx={212} cy={132} rx={20} ry={7} fill={ART.amber} />
          <Ellipse cx={212} cy={124} rx={20} ry={7} fill={ART.gold} />
        </Svg>
      );
    case 'sportsDay':
      return (
        <Svg {...common}>
          <Rect x={0} y={0} width={280} height={170} rx={20} fill={ART.night} />
          <Rect x={104} y={112} width={72} height={44} rx={6} fill={ART.white} />
          <Rect x={62} y={128} width={44} height={28} rx={6} fill={ART.silver} />
          <Rect x={174} y={136} width={44} height={20} rx={6} fill={ART.bronze} />
          <Path d="M122 50 h36 v18 a18 18 0 0 1 -36 0 z" fill={ART.gold} />
          <Rect x={136} y={84} width={8} height={14} fill={ART.amber} />
          <Rect x={126} y={98} width={28} height={10} rx={3} fill={ART.amber} />
          <Path d="M36.5 42 h20 l-5 7 l5 7 h-20 z" fill={ART.green} />
          <Path d="M70.5 32 h20 l-5 7 l5 7 h-20 z" fill={ART.blue} />
          <Path d="M210.5 32 h20 l-5 7 l5 7 h-20 z" fill={ART.amber} />
          <Path d="M244.5 42 h20 l-5 7 l5 7 h-20 z" fill={ART.red} />
        </Svg>
      );
    case 'holiday':
    default:
      return (
        <Svg {...common}>
          <Rect x={0} y={0} width={280} height={170} rx={20} fill={f('care').soft} />
          <Circle cx={62} cy={48} r={20} fill={ART.gold} />
          <Path d="M188 24 l26 30 l-26 30 l-26 -30 z" fill={ART.rose} />
          <Path d="M188 84 C 176 104, 200 112, 184 132 S 170 150, 160 156" fill="none" stroke={f('care').ink} strokeWidth={2} strokeLinecap="round" />
          <Rect x={24} y={118} width={46} height={40} fill={f('care').ink} />
          <Path d="M20 120 l27 -20 l27 20 z" fill={ART.roof} />
          <Rect x={76} y={128} width={38} height={30} fill={ART.amber} />
          <Rect x={120} y={112} width={34} height={46} fill={ART.ochre} />
        </Svg>
      );
  }
}
