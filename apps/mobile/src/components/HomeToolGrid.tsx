import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Touchable } from './Touchable';
import { Icon, isIconName } from './icons';
import { useTheme, useTokens } from '@/theme/theme-context';
import { familyTone } from '@/theme/families';
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
/**
 * Columns for `n` tiles: four, unless four would strand ONE tile alone on its
 * last row — then three (5 → 3+2, 9 → 3+3+3). The family Home's five "Needs
 * you today" tiles left Fees alone on a second row (re-audit 2026-10-08; the
 * UI ledger's figure-row-orphans-a-tile rule).
 */
export function toolColumns(n: number): number {
  if (n <= 4) return 4;
  if (n % 4 === 1 && n % 3 !== 1) return 3;
  return 4;
}

export function HomeToolGrid({
  tools,
  testID,
}: {
  tools: HomeTool[];
  testID?: string;
}): React.JSX.Element {
  const tokens = useTokens();
  const cols = toolColumns(tools.length);
  const { scheme } = useTheme();
  const tone = (t: HomeTool) => familyTone(t.icon, scheme);

  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 0 }}
    >
      {tools.map((tool) => {
        const badge = tool.badge && tool.badge > 0 ? tool.badge : undefined;
        return (
          <View key={tool.label} style={{ width: `${100 / cols}%`, alignItems: 'center' }}>
            <Touchable
              testID={`hometool-${tool.label}`}
              accessibilityLabel={
                badge ? `${tool.label}, ${badge} waiting` : tool.label
              }
              // A filled tile is the urgent one, so its tap gets the firmer tick.
              haptic={tool.live ? 'medium' : 'light'}
              onPress={() => router.push(tool.route as never)}
              style={{ alignItems: 'center', gap: 8, paddingVertical: 2 }}
            >
              <View>
                {/* UI v2: a tinted squircle in the tool's FAMILY colour
                    (theme/families.ts) — learning indigo, money blue, care
                    amber… The tile that needs you now is FILLED with that ink:
                    one bold shape per screen, the Material 3 Expressive finding
                    that the main action is found up to 4x faster. */}
                <View
                  testID={tool.live ? `hometool-live-${tool.label}` : undefined}
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: tool.live ? tone(tool).ink : tone(tool).soft,
                  }}
                >
                  {isIconName(tool.icon) && (
                    <Icon
                      name={tool.icon}
                      size={26}
                      color={tool.live ? tokens.color.onBrand : tone(tool).ink}
                      fillOpacity={tool.live ? 0.3 : 0.18}
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
                  fontSize: 12,
                  lineHeight: 15,
                  textAlign: 'center',
                  color: tokens.color.ink,
                  fontWeight: tool.live ? '700' : '600',
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
