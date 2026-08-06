import { View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import type { PaperPattern } from '@/theme/grounds';

/** Pitch of the ruling, in points. Quad is tighter — it is a maths book. */
const RULED_PITCH = 24;
const QUAD_PITCH = 16;

/**
 * THE FEINT LINES BEHIND A SCREEN.
 *
 * Drawn as an SVG <Pattern> rather than tiled images or a stack of Views:
 * React Native has no repeating background, a full-height column of <View>
 * lines would be hundreds of nodes on a long screen, and an image asset would
 * need a variant per density. One pattern paints any size at any density.
 *
 * Deliberately non-interactive and unlabelled — it is texture, so it must not
 * appear to a screen reader or intercept a touch meant for the content above.
 */
export function PaperRuling({
  pattern,
  ink,
  testID = 'paper-ruling',
}: {
  pattern: PaperPattern;
  /** The screen's ink colour; the ruling is a very low-opacity wash of it. */
  ink: string;
  testID?: string;
}): React.JSX.Element | null {
  if (pattern === 'plain') return null;

  const pitch = pattern === 'quad' ? QUAD_PITCH : RULED_PITCH;
  // Quad sits slightly fainter than ruled because it draws twice as many lines
  // — matching opacity would make the grid twice as loud as the rules.
  const opacity = pattern === 'quad' ? 0.045 : 0.06;

  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="ruling" width={pitch} height={pitch} patternUnits="userSpaceOnUse">
            <Line x1="0" y1={pitch} x2={pitch} y2={pitch} stroke={ink} strokeWidth="1" opacity={opacity} />
            {pattern === 'quad' && (
              <Line x1={pitch} y1="0" x2={pitch} y2={pitch} stroke={ink} strokeWidth="1" opacity={opacity} />
            )}
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ruling)" />
      </Svg>
    </View>
  );
}
