import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { Touchable } from './Touchable';
import { Icon, isIconName } from './icons';
import { useTheme, useTokens } from '@/theme/theme-context';
import { accentFill, toneFamily, toneFill, useFamilyTone } from '@/theme/families';
import type { MoreTone } from '@/lib/staff-nav';

export interface HomeTool {
  label: string;
  /** A duotone glyph name from components/icons.tsx. */
  icon: string;
  /** Where the tile goes. Optional when `onPress` is given. */
  route?: string;
  /** For a tile that does something other than push a route. */
  onPress?: () => void;
  /**
   * What the tool asks of you, as vc24 coloured it: 'amber' (waits on you /
   * someone is talking) or 'green' (good news). Omitted or 'indigo' = the
   * school's accent.
   */
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
 * A tile is a 58 dp squircle in its family's soft tint (every family a shade
 * of the ONE accent, theme/families.ts — the user tried five real hues on
 * 16 Oct 2026 and sent them back: "way too bad") carrying a duotone glyph in
 * the family's ink. State rides ON the tile — a red count, the date, a
 * progress ring — so the grid is glanceable, not just a menu. One tile may be
 * `live` (filled) when something is genuinely outstanding.
 */
export function toolColumns(n: number): number {
  if (n <= 4) return 4;
  if (n % 4 === 1 && n % 3 !== 1) return 3;
  return 4;
}

export function HomeToolGrid({ tools, testID, columns }: { tools: HomeTool[]; testID?: string; /** Fixed column count (HomeMenu groups share 4 so tiles line up between groups). */ columns?: number }): React.JSX.Element {
  const tokens = useTokens();
  const cols = columns ?? toolColumns(tools.length);
  const familyTone = useFamilyTone();
  const { scheme } = useTheme();
  // The live tile is THE filled surface: same deep fill as the one button (accentFill).
  const fill = accentFill(tokens.color, scheme);

  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 0 }}>
      {tools.map((tool) => {
        const badge = tool.badge && tool.badge > 0 ? tool.badge : undefined;
        const meaning = tool.tone === 'amber' || tool.tone === 'green' ? tool.tone : null;
        const t = meaning ? toneFamily(meaning, tokens.color, scheme) : familyTone(tool.icon);
        const live = meaning ? toneFill(meaning, tokens.color) : fill;
        const bg = tool.live ? live.bg : t.soft;
        const ink = tool.live ? live.fg : t.ink;
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
                    <Icon name={tool.icon} size={26} color={ink} fillOpacity={tool.live ? 0.3 : 0.18} />
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

/** One labelled group of doors inside the Home menu. */
export interface HomeToolGroup {
  /** Sentence case, a few plain words: "In class", "For you". */
  title: string;
  tools: HomeTool[];
}

/**
 * THE HOME MENU — one card, every door on the Home (direction C: the grid is
 * the one place a door lives). Given `groups` (user, 18 Oct 2026: "put the
 * menu items in different categories to manage better") the card is split
 * into labelled groups — still ONE card, so the Home still has one menu
 * (ui-mistake-ledger home-split-into-two-menus). Inside each group, badged
 * tiles come first; an empty group is not drawn.
 */
export function HomeMenu({ tools, groups, testID = 'home-menu' }: { tools?: HomeTool[]; groups?: HomeToolGroup[]; testID?: string }): React.JSX.Element {
  const tokens = useTokens();
  const c = tokens.color;
  const has = (t: HomeTool) => (t.badge ?? 0) > 0;
  const order = (list: HomeTool[]) => [...list.filter(has), ...list.filter((t) => !has(t))];
  const sections = (groups ?? [{ title: '', tools: tools ?? [] }]).filter((g) => g.tools.length > 0);
  return (
    <View
      testID={testID}
      style={{ backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.line, paddingTop: groups ? 16 : 20, paddingBottom: 16, paddingHorizontal: 2, gap: 24 }}
    >
      {sections.map((g, i) => (
        <View key={g.title || i} testID={g.title ? `${testID}-group-${g.title}` : undefined} style={{ gap: 12 }}>
          {g.title ? (
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.3}
              style={{ marginHorizontal: 18, fontSize: 13, fontWeight: '700', color: c.sub, letterSpacing: 0.2 }}
            >
              {g.title}
            </Text>
          ) : null}
          <HomeToolGrid testID={i === 0 ? `${testID}-grid` : `${testID}-grid-${i}`} tools={order(g.tools)} columns={groups ? 4 : undefined} />
        </View>
      ))}
    </View>
  );
}
