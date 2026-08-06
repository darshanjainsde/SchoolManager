import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { router } from 'expo-router';
import { Touchable } from './Touchable';
import { Icon, isIconName } from './icons';
import { useTokens } from '@/theme/theme-context';
import type { MoreTone } from '@/lib/staff-nav';

export interface HomeTool {
  label: string;
  /** A duotone glyph name from components/icons.tsx. */
  icon: string;
  route: string;
  tone?: MoreTone;
  /** A count worth interrupting for. Zero and undefined both render nothing. */
  badge?: number;
  /**
   * The ONE thing asking for attention right now. At most one tool in a grid
   * should set this — see the note on `live` below.
   */
  live?: boolean;
}

/**
 * THE TILE GRID BOTH HOME SCREENS ARE BUILT FROM.
 *
 * One filled tile per screen, and only when something is genuinely outstanding.
 * That constraint is the whole design: the old drawer tinted every tile by
 * category, which told a teacher which bucket a tool belonged to — something
 * they already knew — and spent all the available emphasis before anything
 * urgent could claim it. Colour lives in the GLYPH here; the fill is reserved.
 *
 * `live` is a property of the day, not of a tool: the register tile lights
 * because a register is open, and goes quiet the moment the day is clean.
 */
export function HomeToolGrid({
  tools,
  testID,
}: {
  tools: HomeTool[];
  testID?: string;
}): React.JSX.Element {
  const tokens = useTokens();

  function hue(tone: MoreTone | undefined): string {
    if (tone === 'amber') return tokens.color.late;
    if (tone === 'green') return tokens.color.green;
    return tokens.color.indigo;
  }

  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 0 }}
    >
      {tools.map((tool) => {
        const badge = tool.badge && tool.badge > 0 ? tool.badge : undefined;
        return (
          <View key={tool.label} style={{ width: '25%', alignItems: 'center' }}>
            <Touchable
              testID={`hometool-${tool.label}`}
              accessibilityLabel={
                badge ? `${tool.label}, ${badge} waiting` : tool.label
              }
              // A filled tile is the urgent one, so its tap gets the firmer tick.
              haptic={tool.live ? 'medium' : 'light'}
              // The raised dome presses DOWN (pitch's translateY), not just
              // smaller — the artifact's `:active` made this the whole feel.
              pressTranslateY={2.5}
              onPress={() => router.push(tool.route as never)}
              style={{ alignItems: 'center', gap: 8, paddingVertical: 2 }}
            >
              <View>
                {/* Pitch №3: the raised dome. A real drop shadow + elevation
                    lifts every tile off the page; Touchable's press-in scale
                    is what pushes it back down under the thumb. The live tile
                    keeps the amber fill and throws a warmer shadow, so "act
                    now" is lit AND raised highest. */}
                <View
                  testID={tool.live ? `hometool-live-${tool.label}` : undefined}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: tool.live ? tokens.color.amber : tokens.color.line,
                    backgroundColor: tool.live ? tokens.color.amber : tokens.color.surface,
                    shadowColor: tool.live ? tokens.color.amber : tokens.color.ink,
                    shadowOpacity: tool.live ? 0.45 : 0.16,
                    shadowRadius: tool.live ? 10 : 8,
                    shadowOffset: { width: 0, height: 5 },
                    elevation: tool.live ? 7 : 5,
                    overflow: 'hidden',
                  }}
                >
                  {/* The dome shading from the approved artifact: light top →
                      the theme's darker shade at the bottom (`--g-hi`→`--g-lo`).
                      A flat fill read as a sticker; this reads as a dome. The
                      live tile keeps its solid amber — its fill IS the signal.
                      (overflow hidden clips the gradient to the circle; the
                      drop shadow lives on this same View so it survives.) */}
                  {!tool.live && (
                    <Svg
                      width={56}
                      height={56}
                      style={{ position: 'absolute', top: 0, left: 0 }}
                      pointerEvents="none"
                    >
                      <Defs>
                        <LinearGradient id={`dome-${tool.label}`} x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0" stopColor={tokens.color.surface} />
                          <Stop offset="1" stopColor={tokens.color.surfaceMuted} />
                        </LinearGradient>
                      </Defs>
                      <Circle cx={28} cy={28} r={28} fill={`url(#dome-${tool.label})`} />
                    </Svg>
                  )}
                  {isIconName(tool.icon) && (
                    <Icon
                      name={tool.icon}
                      size={24}
                      color={tool.live ? tokens.color.ink : hue(tool.tone)}
                      // On a filled tile a 20% body vanishes into the fill.
                      fillOpacity={tool.live ? 0.34 : 0.2}
                    />
                  )}
                </View>
                {badge !== undefined && (
                  <View
                    testID={`hometool-badge-${tool.label}`}
                    style={{
                      position: 'absolute',
                      top: -3,
                      right: -3,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      paddingHorizontal: 5,
                      backgroundColor: tokens.color.red,
                      // Page-coloured cut-out, same as the bell's badge — the
                      // badge sits on the page, not inside the dome's rim.
                      borderWidth: 2,
                      borderColor: tokens.color.appBg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={{ color: tokens.color.onBrand, fontSize: 10, fontWeight: '800' }}
                    >
                      {badge > 9 ? '9+' : badge}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={2}
                maxFontSizeMultiplier={1.3}
                style={{
                  fontSize: 10.5,
                  lineHeight: 13,
                  textAlign: 'center',
                  color: tool.live ? tokens.color.ink : tokens.color.sub,
                  fontWeight: tool.live ? '700' : '500',
                }}
              >
                {tool.label}
              </Text>
            </Touchable>
          </View>
        );
      })}
    </View>
  );
}
