import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { Touchable } from './Touchable';
import { Icon, isIconName } from './icons';
import { useTokens } from '@/theme/theme-context';
import { useFamilyTone } from '@/theme/families';
import type { MoreTone } from '@/lib/staff-nav';

export interface HomeTool {
  label: string;
  /** A duotone glyph name from components/icons.tsx. */
  icon: string;
  /** Where the tile goes. Optional when `onPress` is given. */
  route?: string;
  /** For a tile that does something other than push a route. */
  onPress?: () => void;
  tone?: MoreTone;
  /** A count worth interrupting for. Zero and undefined both render nothing. */
  badge?: number;
  /** Live state on the tile that is not a count: today's date on Holidays. */
  date?: string;
  /** Live state as a share: the taught-so-far ring on Syllabus (0–100). */
  arc?: number;
  /**
   * The ONE thing asking for attention right now. At most one tool in a grid
   * should set this.
   */
  live?: boolean;
  /** Overrides the default `hometool-${label}` test id (desk homes keep their `hero-act-*` ids). */
  testID?: string;
}

/**
 * THE TILE GRID EVERY HOME IS BUILT FROM (direction C, 16 Oct 2026).
 *
 * A tile is a 58 dp squircle in its FAMILY's soft tint carrying a duotone
 * object in the family's ink (theme/families.ts): teal for attendance and
 * requests, gold for money, coral for people, sky for school life, the
 * accent for learning. State rides ON the tile — a red count, the date, a
 * progress ring — so the grid is glanceable, not just a menu. One tile may be
 * `live` (filled) when something is genuinely outstanding.
 */
export function toolColumns(n: number): number {
  if (n <= 4) return 4;
  if (n % 4 === 1 && n % 3 !== 1) return 3;
  return 4;
}

export function HomeToolGrid({ tools, testID }: { tools: HomeTool[]; testID?: string }): React.JSX.Element {
  const tokens = useTokens();
  const cols = toolColumns(tools.length);
  const familyTone = useFamilyTone();

  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 0 }}>
      {tools.map((tool) => {
        const badge = tool.badge && tool.badge > 0 ? tool.badge : undefined;
        const t = familyTone(tool.icon);
        const bg = tool.live ? t.ink : t.soft;
        const ink = tool.live ? tokens.color.onBrand : t.ink;
        const go = () => {
          if (tool.onPress) tool.onPress();
          else if (tool.route) router.push(tool.route as never);
        };
        return (
          <View key={tool.label} style={{ width: `${100 / cols}%`, alignItems: 'center' }}>
            <Touchable
              testID={tool.testID ?? `hometool-${tool.label}`}
              accessibilityLabel={badge ? `${tool.label}, ${badge} waiting` : tool.label}
              haptic={tool.live ? 'medium' : 'light'}
              onPress={go}
              style={{ alignItems: 'center', gap: 8, paddingVertical: 2 }}
            >
              <View>
                <View
                  testID={tool.live ? `hometool-live-${tool.label}` : undefined}
                  style={{ width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}
                >
                  {isIconName(tool.icon) && (
                    <Icon name={tool.icon} size={30} color={ink} knockColor={bg} fillOpacity={tool.live ? 0.3 : 0.22} />
                  )}
                </View>
                {badge !== undefined && (
                  <View
                    testID={`hometool-badge-${tool.label}`}
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      paddingHorizontal: 5,
                      backgroundColor: tokens.color.red,
                      borderWidth: 2,
                      borderColor: tokens.color.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text maxFontSizeMultiplier={1.2} style={{ color: tokens.color.onBrand, fontSize: 10, fontWeight: '800' }}>
                      {badge > 9 ? '9+' : badge}
                    </Text>
                  </View>
                )}
                {tool.date !== undefined && badge === undefined && (
                  <View
                    testID={`hometool-date-${tool.label}`}
                    style={{
                      position: 'absolute',
                      bottom: -4,
                      right: -4,
                      minWidth: 20,
                      height: 18,
                      borderRadius: 9,
                      paddingHorizontal: 5,
                      backgroundColor: t.ink,
                      borderWidth: 2,
                      borderColor: tokens.color.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text maxFontSizeMultiplier={1.2} style={{ color: t.soft, fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                      {tool.date}
                    </Text>
                  </View>
                )}
                {tool.arc !== undefined && badge === undefined && tool.date === undefined && (
                  <View
                    testID={`hometool-arc-${tool.label}`}
                    accessibilityLabel={`${Math.round(tool.arc)}% so far`}
                    style={{ position: 'absolute', bottom: -5, right: -5, width: 22, height: 22, borderRadius: 11, backgroundColor: tokens.color.surface, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Svg width={18} height={18} viewBox="0 0 18 18" style={{ transform: [{ rotate: '-90deg' }] }}>
                      <Circle cx={9} cy={9} r={6.5} stroke={t.soft} strokeWidth={3} fill="none" />
                      <Circle
                        cx={9}
                        cy={9}
                        r={6.5}
                        stroke={t.ink}
                        strokeWidth={3}
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${(Math.max(0, Math.min(100, tool.arc)) / 100) * 2 * Math.PI * 6.5} ${2 * Math.PI * 6.5}`}
                      />
                    </Svg>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={2}
                maxFontSizeMultiplier={1.3}
                style={{ fontSize: 12, lineHeight: 15, textAlign: 'center', color: tokens.color.ink, fontWeight: tool.live ? '700' : '600' }}
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

/**
 * THE HOME MENU — one card, one grid, badged tiles first. With the hero's
 * quick actions gone (direction C) this is the one place every door lives.
 */
export function HomeMenu({ tools, testID = 'home-menu' }: { tools: HomeTool[]; testID?: string }): React.JSX.Element {
  const tokens = useTokens();
  const c = tokens.color;
  const has = (t: HomeTool) => (t.badge ?? 0) > 0;
  const ordered = [...tools.filter(has), ...tools.filter((t) => !has(t))];
  return (
    <View
      testID={testID}
      style={{ backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.line, paddingTop: 20, paddingBottom: 16, paddingHorizontal: 4 }}
    >
      <HomeToolGrid testID={`${testID}-grid`} tools={ordered} />
    </View>
  );
}
