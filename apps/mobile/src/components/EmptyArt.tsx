import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View, type ViewStyle } from 'react-native';
import { useTheme, useTokens } from '@/theme/theme-context';
import { familyTone } from '@/theme/families';
import { useReduceMotion } from '@/theme/motion';
import { ART } from '@/theme/illustration';
import { Icon, type IconName } from './icons';

/**
 * A SMALL MOVING PICTURE WHERE A SCREEN WOULD OTHERWISE BE EMPTY (UI v2, 9 Oct 2026).
 *
 * The user's ask, in their words: "empty space fill with some animations till
 * data comes in". So an empty screen shows one everyday school moment, in
 * motion, above its existing title and line: someone typing a reply, a pencil
 * writing on a page, a finger picking a class, a coin dropping into the fee
 * slip. When the data arrives the empty state is not rendered, so the
 * picture goes with it.
 *
 * Kept light on purpose:
 *  - plain Views and the app's own glyphs, no images, no new library;
 *  - ONE Animated.Value per picture, looping on the native driver
 *    (transform + opacity only), so after it starts the JS thread does nothing;
 *  - 112 dp tall, under a third of a phone screen;
 *  - Reduce Motion: drawn still, mid-loop, so the picture still reads;
 *  - hidden from screen readers: the words below it carry the meaning.
 */
export type ArtScene =
  | 'chat'
  | 'write'
  | 'choose'
  | 'search'
  | 'shelf'
  | 'coin'
  | 'ball'
  | 'calendar'
  | 'plane'
  | 'done'
  | 'locked'
  | 'cake'
  | 'phone';

const BY_ICON: Partial<Record<IconName, ArtScene>> = {
  messages: 'chat',
  concern: 'chat',
  assignments: 'write',
  diary: 'write',
  notes: 'write',
  report: 'write',
  results: 'write',
  take: 'choose',
  search: 'search',
  library: 'shelf',
  fees: 'coin',
  sports: 'ball',
  holidays: 'calendar',
  timetable: 'calendar',
  notices: 'plane',
  send: 'plane',
  requests: 'plane',
  mail: 'plane',
  check: 'done',
  lock: 'locked',
  cake: 'cake',
  phone: 'phone',
};

/**
 * Which picture an empty state gets. `kind` wins where it changes the story
 * (a locked page is about the lock, not the tool); otherwise the tool's glyph
 * picks it. An error never gets a picture, and a bare sentence with no glyph
 * and no kind ("Opening the diary…") stays a bare sentence.
 */
export function sceneFor(icon?: IconName, kind?: string): ArtScene | undefined {
  if (kind === 'error') return undefined;
  if (kind === 'locked') return 'locked';
  if (kind === 'done') return 'done';
  if (kind === 'choose') return 'choose';
  if (kind === 'search') return 'search';
  if (icon && BY_ICON[icon]) return BY_ICON[icon];
  if (kind === 'first') return 'plane';
  return undefined;
}

const PERIOD: Record<ArtScene, number> = {
  chat: 2400, write: 2800, choose: 2600, search: 3200, shelf: 3000, coin: 2200, ball: 1100,
  calendar: 3500, plane: 3200, done: 2000, locked: 2600, cake: 900, phone: 1800,
};

export const ART_HEIGHT = 112;

export function EmptyArt({ scene, icon, testID }: { scene: ArtScene; icon?: IconName; testID?: string }) {
  const tokens = useTokens();
  const { scheme } = useTheme();
  const c = tokens.color;
  const tone = familyTone(icon ?? glyphOf(scene), scheme);
  const t = useRef(new Animated.Value(0)).current;
  const reduced = useReduceMotion();

  useEffect(() => {
    if (reduced.current) {
      t.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: PERIOD[scene], easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, scene, reduced]);

  const paper = c.surface;
  const ink = tone.ink;
  const p: P = { t, ink, soft: tone.soft, paper, line: c.line2, sub: c.sub };

  return (
    <View
      testID={testID ?? `empty-art-${scene}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: '100%', height: ART_HEIGHT, borderRadius: 18, backgroundColor: tone.soft, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 240, height: ART_HEIGHT }}>{draw(scene, p)}</View>
    </View>
  );
}

type P = { t: Animated.Value; ink: string; soft: string; paper: string; line: string; sub: string };

function glyphOf(scene: ArtScene): IconName {
  const g: Record<ArtScene, IconName> = {
    chat: 'messages', write: 'diary', choose: 'take', search: 'search', shelf: 'library', coin: 'fees',
    ball: 'sports', calendar: 'holidays', plane: 'send', done: 'check', locked: 'lock', cake: 'cake', phone: 'phone',
  };
  return g[scene];
}

/** Interpolate the loop value over keyframes. */
function k(t: Animated.Value, input: number[], output: number[]) {
  return t.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' });
}

const abs = (s: ViewStyle): ViewStyle => ({ position: 'absolute', ...s });

function Bar({ x, y, w, h = 6, color, r = 3 }: { x: number; y: number; w: number; h?: number; color: string; r?: number }) {
  return <View style={abs({ left: x, top: y, width: w, height: h, borderRadius: r, backgroundColor: color })} />;
}

function draw(scene: ArtScene, p: P): React.ReactNode {
  const { t, ink, paper, line, soft } = p;
  switch (scene) {
    // A family's question, and the teacher already typing back.
    case 'chat':
      return (
        <>
          <View style={abs({ left: 30, top: 18, width: 120, height: 30, borderRadius: 14, borderBottomLeftRadius: 4, backgroundColor: paper })}>
            <Bar x={12} y={12} w={84} color={line} />
          </View>
          <Animated.View
            style={abs({
              right: 30, top: 58, width: 76, height: 32, borderRadius: 16, borderBottomRightRadius: 4, backgroundColor: ink,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: k(t, [0, 0.12, 0.9, 1], [0, 1, 1, 0]),
              transform: [{ translateY: k(t, [0, 0.12], [8, 0]) }],
            })}
          >
            {[0, 1, 2].map((i) => (
              <Animated.View
                key={i}
                style={{
                  width: 7, height: 7, borderRadius: 4, backgroundColor: paper,
                  transform: [{ translateY: k(t, [0.15 + i * 0.1, 0.25 + i * 0.1, 0.35 + i * 0.1, 0.55 + i * 0.1, 0.65 + i * 0.1], [0, -5, 0, -5, 0]) }],
                }}
              />
            ))}
          </Animated.View>
        </>
      );

    // A pencil writing the next line of the page.
    case 'write':
      return (
        <>
          <View style={abs({ left: 62, top: 12, width: 116, height: 88, borderRadius: 10, backgroundColor: paper })}>
            <View style={abs({ left: 18, top: 0, width: 2, height: 88, backgroundColor: soft })} />
            <Bar x={28} y={18} w={70} color={line} />
            <Bar x={28} y={34} w={56} color={line} />
            <View style={abs({ left: 28, top: 50, width: 72, height: 6, borderRadius: 3, overflow: 'hidden' })}>
              <Animated.View style={{ width: 72, height: 6, borderRadius: 3, backgroundColor: ink, transform: [{ translateX: k(t, [0, 0.7, 1], [-72, 0, 0]) }] }} />
            </View>
            <Bar x={28} y={66} w={40} color={line} />
          </View>
          <Animated.View
            style={abs({
              left: 86, top: 26, width: 8, height: 34, borderRadius: 2, backgroundColor: ART.amber,
              transform: [{ translateX: k(t, [0, 0.7, 0.85, 1], [0, 70, 70, 0]) }, { rotate: '28deg' }],
            })}
          >
            <View style={abs({ left: 0, bottom: -5, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: ART.graphite })} />
          </Animated.View>
        </>
      );

    // A finger picking the second class.
    case 'choose':
      return (
        <>
          {[0, 1, 2].map((i) => (
            <View key={i} style={abs({ left: 18 + i * 72, top: 34, width: 62, height: 34, borderRadius: 17, backgroundColor: paper, alignItems: 'center', justifyContent: 'center' })}>
              {i === 1 && <Animated.View style={abs({ left: 0, top: 0, width: 62, height: 34, borderRadius: 17, backgroundColor: ink, opacity: k(t, [0, 0.45, 0.5, 0.85, 0.95], [0, 0, 1, 1, 0]) })} />}
              <View style={{ width: 30, height: 6, borderRadius: 3, backgroundColor: line }} />
            </View>
          ))}
          <Animated.View
            style={abs({
              left: 112, top: 58, width: 22, height: 22, borderRadius: 11, backgroundColor: ink, opacity: 0.35,
              transform: [
                { translateX: k(t, [0, 0.4, 1], [70, 0, 0]) },
                { translateY: k(t, [0, 0.4, 0.5, 1], [24, 0, -4, 18]) },
                { scale: k(t, [0.4, 0.47, 0.55], [1, 0.7, 1]) },
              ],
            })}
          />
        </>
      );

    // A magnifier moving along the spines.
    case 'search':
      return (
        <>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Bar key={i} x={42 + i * 23} y={30 + (i % 3) * 6} w={16} h={58 - (i % 3) * 6} r={3} color={i % 2 ? paper : line} />
          ))}
          <Bar x={34} y={88} w={172} h={4} r={2} color={ink} />
          <Animated.View
            style={abs({ left: 40, top: 22, transform: [{ translateX: k(t, [0, 0.5, 1], [0, 130, 0]) }, { translateY: k(t, [0, 0.25, 0.5, 0.75, 1], [0, 8, 0, 8, 0]) }] })}
          >
            <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 4, borderColor: ink, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            <View style={abs({ left: 28, top: 30, width: 6, height: 16, borderRadius: 3, backgroundColor: ink, transform: [{ rotate: '-45deg' }] })} />
          </Animated.View>
        </>
      );

    // A full shelf; one book is lifted out and put back.
    case 'shelf':
      return (
        <>
          {[0, 1, 2, 3, 4, 5].map((i) =>
            i === 3 ? (
              <Animated.View
                key={i}
                style={abs({ left: 50 + i * 24, top: 30, width: 18, height: 58, borderRadius: 3, backgroundColor: ink, transform: [{ translateY: k(t, [0, 0.2, 0.45, 0.6, 0.8, 1], [0, -22, -22, -22, 0, 0]) }, { rotate: '0deg' }] })}
              >
                <Bar x={4} y={10} w={10} h={3} r={1} color={paper} />
              </Animated.View>
            ) : (
              <Bar key={i} x={50 + i * 24} y={30 + (i % 2) * 6} w={18} h={58 - (i % 2) * 6} r={3} color={i % 2 ? paper : line} />
            ),
          )}
          <Bar x={36} y={88} w={168} h={5} r={2} color={p.sub} />
        </>
      );

    // A coin dropping onto the fee slip.
    case 'coin':
      return (
        <>
          <View style={abs({ left: 70, top: 46, width: 100, height: 54, borderRadius: 10, backgroundColor: paper })}>
            <Bar x={14} y={14} w={50} color={line} />
            <Bar x={14} y={28} w={72} color={line} />
          </View>
          <Animated.View
            style={abs({
              left: 104, top: 4, width: 32, height: 32, borderRadius: 16, backgroundColor: ART.amber, alignItems: 'center', justifyContent: 'center',
              opacity: k(t, [0, 0.1, 0.55, 0.7, 1], [0, 1, 1, 0, 0]),
              transform: [{ translateY: k(t, [0, 0.45, 0.52, 0.6], [-10, 28, 22, 28]) }],
            })}
          >
            <Text style={{ color: ART.coinInk, fontWeight: '800', fontSize: 16 }}>₹</Text>
          </Animated.View>
        </>
      );

    // A football bouncing on the ground, its shadow breathing with it.
    case 'ball':
      return (
        <>
          <Bar x={40} y={94} w={160} h={3} r={2} color={line} />
          <Animated.View style={abs({ left: 100, top: 90, width: 40, height: 8, borderRadius: 4, backgroundColor: ink, opacity: k(t, [0, 0.5, 1], [0.35, 0.1, 0.35]), transform: [{ scaleX: k(t, [0, 0.5, 1], [1, 0.5, 1]) }] })} />
          <Animated.View
            style={abs({
              left: 102, top: 52, width: 36, height: 36, borderRadius: 18, backgroundColor: paper, borderWidth: 3, borderColor: ink, alignItems: 'center', justifyContent: 'center',
              transform: [
                { translateY: k(t, [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1], [0, -22, -34, -40, -34, -22, 0]) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
              ],
            })}
          >
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: ink, transform: [{ rotate: '45deg' }] }} />
          </Animated.View>
        </>
      );

    // A month page; the "today" ring walks across the days.
    case 'calendar': {
      const days = Array.from({ length: 14 }, (_, i) => i);
      return (
        <View style={abs({ left: 50, top: 10, width: 140, height: 92, borderRadius: 12, backgroundColor: paper, overflow: 'hidden' })}>
          <View style={{ height: 22, backgroundColor: ink }} />
          {[0, 1].map((ring) => (
            <View key={ring} style={abs({ left: 30 + ring * 72, top: -6, width: 8, height: 16, borderRadius: 4, backgroundColor: p.sub })} />
          ))}
          {days.map((i) => (
            <View key={i} style={abs({ left: 12 + (i % 7) * 18, top: 34 + Math.floor(i / 7) * 24, width: 10, height: 10, borderRadius: 3, backgroundColor: i === 11 ? ART.amber : line })} />
          ))}
          <Animated.View
            style={abs({
              left: 7, top: 29, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: ink,
              transform: [
                { translateX: k(t, [0, 0.4, 0.5, 0.9, 1], [0, 108, 108, 72, 0]) },
                { translateY: k(t, [0, 0.4, 0.5, 0.9, 1], [0, 0, 24, 24, 0]) },
              ],
            })}
          />
        </View>
      );
    }

    // A note folded into a paper plane and sent off.
    case 'plane':
      return (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <Bar key={i} x={30 + i * 26} y={84 - i * 12} w={12} h={3} r={2} color={line} />
          ))}
          <Animated.View
            style={abs({
              left: 20, top: 66,
              opacity: k(t, [0, 0.1, 0.8, 1], [0, 1, 1, 0]),
              transform: [{ translateX: k(t, [0, 1], [0, 170]) }, { translateY: k(t, [0, 0.5, 1], [0, -36, -54]) }, { rotate: '-12deg' }],
            })}
          >
            <Icon name="send" size={36} color={ink} fillOpacity={0.35} />
          </Animated.View>
        </>
      );

    // Everything done: the tick, and a ring spreading out from it.
    case 'done':
      return (
        <>
          <Animated.View style={abs({ left: 90, top: 26, width: 60, height: 60, borderRadius: 30, borderWidth: 3, borderColor: ink, opacity: k(t, [0, 0.8, 1], [0.6, 0, 0]), transform: [{ scale: k(t, [0, 0.8, 1], [1, 1.7, 1.7]) }] })} />
          <Animated.View style={abs({ left: 90, top: 26, width: 60, height: 60, borderRadius: 30, backgroundColor: ink, alignItems: 'center', justifyContent: 'center', transform: [{ scale: k(t, [0, 0.1, 0.2, 1], [1, 1.08, 1, 1]) }] })}>
            <Icon name="check" size={32} color={paper} fillOpacity={0} />
          </Animated.View>
          <Bar x={40} y={46} w={8} h={8} r={2} color={ART.amber} />
          <Bar x={192} y={32} w={7} h={7} r={4} color={line} />
          <Bar x={186} y={80} w={9} h={9} r={2} color={ink} />
        </>
      );

    // A locked page and the key that opens it.
    case 'locked':
      return (
        <>
          <View style={abs({ left: 96, top: 22, width: 64, height: 70, borderRadius: 12, backgroundColor: paper, alignItems: 'center', justifyContent: 'center' })}>
            <Animated.View style={{ transform: [{ rotate: k(t, [0.55, 0.6, 0.65, 0.7, 0.75], [0, 8, -8, 8, 0]).interpolate({ inputRange: [-8, 8], outputRange: ['-8deg', '8deg'] }) }] }}>
              <Icon name="lock" size={34} color={ink} fillOpacity={0.25} />
            </Animated.View>
          </View>
          <Animated.View style={abs({ left: 30, top: 42, opacity: k(t, [0, 0.1, 0.85, 1], [0, 1, 1, 0]), transform: [{ translateX: k(t, [0, 0.5, 1], [0, 40, 40]) }] })}>
            <Icon name="key" size={30} color={ART.coinDark} fillOpacity={0.3} />
          </Animated.View>
        </>
      );

    // Birthday cake with a candle that flickers.
    case 'cake':
      return (
        <>
          <View style={abs({ left: 80, top: 56, width: 80, height: 40, borderRadius: 8, backgroundColor: paper })}>
            <Bar x={0} y={12} w={80} h={6} r={0} color={soft} />
          </View>
          <Bar x={117} y={36} w={6} h={20} r={2} color={ink} />
          <Animated.View style={abs({ left: 114, top: 20, width: 12, height: 16, borderRadius: 8, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: ART.amber, opacity: k(t, [0, 0.5, 1], [1, 0.7, 1]), transform: [{ scaleY: k(t, [0, 0.5, 1], [1, 0.8, 1]) }, { rotate: '0deg' }] })} />
        </>
      );

    // A phone sending out its signal.
    case 'phone':
      return (
        <>
          {[0, 1].map((i) => (
            <Animated.View
              key={i}
              style={abs({ left: 96, top: 32, width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: ink, opacity: k(t, [0, 0.5 + i * 0.2, 1], [0.6, 0.15, 0]), transform: [{ scale: k(t, [0, 1], [1 + i * 0.3, 2 + i * 0.3]) }] })}
            />
          ))}
          <View style={abs({ left: 106, top: 26, width: 28, height: 60, borderRadius: 7, backgroundColor: paper, borderWidth: 3, borderColor: ink })} />
        </>
      );
  }
}
