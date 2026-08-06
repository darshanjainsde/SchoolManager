import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { brand, font, type GatePalette } from '@/theme/tokens';
import { useTheme } from '@/theme/theme-context';

/**
 * The entry gate's living background — "Open Doors", the approved concept
 * (pitch №2, final): the camera walks from door to door through the school
 * without ever stopping. Each door is one feature's room; through its glass
 * the next door is already growing nearer, then the camera glides straight
 * through and the next takes its place.
 *
 * Endless by construction: six doors staggered across one shared 27s cycle
 * (a new room every 4.5s), each door alive only in the last third of its
 * cycle, so exactly two are ever on screen and there is no loop seam. Scale
 * steps are exponential so the walking pace feels constant, per the pitch —
 * no hold anywhere.
 *
 * No video file, no new native deps: react-native-svg (the gradient) and the
 * built-in Animated API on the native driver.
 */

const CYCLE_MS = 27_000;

interface Door {
  icon: keyof typeof Ionicons.glyphMap;
  name: string;
  line: string;
  stat: string;
  accent: string;
}

/** One feature per room, each with its own accent — from the approved pitch. */
const DOORS: Door[] = [
  { icon: 'checkmark-done', name: 'Attendance', line: 'Roll call in ten seconds, synced to every family.', stat: '24/26 PRESENT', accent: brand.gate.accents.attendance },
  { icon: 'book', name: 'Daily Diary', line: 'What happened in class today, signed by home.', stat: '2 TO SIGN', accent: brand.gate.accents.diary },
  { icon: 'star', name: 'Results', line: 'Marks entered once, report cards everywhere.', stat: 'TERM 2 OUT', accent: brand.gate.accents.results },
  { icon: 'calendar', name: 'Timetable', line: 'Every period, every room, every substitution.', stat: '8 PERIODS TODAY', accent: brand.gate.accents.timetable },
  { icon: 'megaphone', name: 'Notices', line: 'One post reaches every family, instantly.', stat: 'SPORTS DAY FRI', accent: brand.gate.accents.notices },
  { icon: 'chatbubbles', name: 'Messages', line: 'School and home, one quiet thread.', stat: '3 NEW', accent: brand.gate.accents.messages },
];

const N = DOORS.length;

/** Exponential scale steps (constant perceived walking speed) — ported
 *  directly from the pitch's `@keyframes enter`. */
const SCALE_IN = [0, 0.66, 0.69, 0.745, 0.83, 0.915, 0.97, 1];
const SCALE_OUT = [0.06, 0.06, 0.09, 0.2, 0.65, 2.1, 4.5, 7];
const FADE_IN = [0, 0.66, 0.69, 0.83, 0.97, 1];
const FADE_OUT = [0, 0, 0.9, 1, 1, 0];

function DoorLayer({ door, index, centerY }: { door: Door; index: number; centerY: number }) {
  const { scheme } = useTheme();
  const g: GatePalette = scheme === 'dark' ? brand.gate.dark : brand.gate.light;
  // Phase-staggered: door i starts i/N of the way through the shared cycle,
  // finishes the partial first pass at natural speed, then loops full cycles.
  const v = useRef(new Animated.Value(index / N)).current;

  useEffect(() => {
    const first = Animated.timing(v, {
      toValue: 1,
      duration: CYCLE_MS * (1 - index / N),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    const rest = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const anim = Animated.sequence([first, rest]);
    anim.start();
    return () => anim.stop();
  }, [v, index]);

  const scale = v.interpolate({ inputRange: SCALE_IN, outputRange: SCALE_OUT });
  const opacity = v.interpolate({ inputRange: FADE_IN, outputRange: FADE_OUT });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.doorLayer, { top: centerY - DOOR_H / 2, opacity, transform: [{ scale }] }]}
    >
      <View style={[styles.door, { backgroundColor: g.doorFill, borderColor: g.doorBorder }]}>
        {/* the lintel — the accent bar over the doorway */}
        <View style={[styles.lintel, { backgroundColor: door.accent }]} />
        <Text style={[styles.roomTag, { color: g.roomTag }]}>{`ROOM ${index + 1} OF ${N}`}</Text>
        <View style={[styles.knob, { backgroundColor: door.accent }]} />
        <View style={[styles.icoWrap, { backgroundColor: `${door.accent}22` }]}>
          <Ionicons name={door.icon} size={19} color={door.accent} />
        </View>
        <Text style={[styles.doorName, { color: g.name }]}>{door.name}</Text>
        <Text style={[styles.doorLine, { color: g.line }]}>{door.line}</Text>
        <View style={[styles.statChip, { backgroundColor: `${door.accent}1F` }]}>
          <Text style={[styles.statText, { color: door.accent }]}>{door.stat}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

/** Gentle handheld sway — two out-of-phase drifts so the camera feels on foot. */
function useSway(enabled: boolean) {
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) return;
    const drift = (val: Animated.Value, ms: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
    const ax = drift(x, 3500);
    const ay = drift(y, 4600);
    ax.start();
    ay.start();
    return () => {
      ax.stop();
      ay.stop();
    };
  }, [enabled, x, y]);
  return {
    translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-3, 3] }),
    translateY: y.interpolate({ inputRange: [0, 1], outputRange: [2, -3] }),
  };
}

export function OpenDoorsScene() {
  const { scheme } = useTheme();
  const g: GatePalette = scheme === 'dark' ? brand.gate.dark : brand.gate.light;
  const { width, height } = useWindowDimensions();

  // Reduce Motion must be decided BEFORE anything moves (see the motion.ts
  // ref-timing lesson: a ref read in a mount effect always sees the initial
  // value). Resolved into STATE; until it answers — and whenever it answers
  // true — the gate is the still sunlit gradient, which is a correct screen
  // in its own right, not a degraded one.
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => live && setReduced(v))
      .catch(() => live && setReduced(false));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(v));
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const animate = reduced === false;
  const sway = useSway(animate);
  // Doors converge on a vanishing point ~39% down: the sheet owns the bottom
  // third, the walk owns the rest.
  const centerY = height * 0.39;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="entry-scene">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* No fragment inside LinearGradient: react-native-svg injects a
              `parent` prop into its children, which a Fragment rejects loudly. */}
          <LinearGradient id="gatebg" x1="0" y1="0" x2="0" y2="1">
            {(
              [
                ['0', g.bgTop],
                ['0.42', g.bgMid],
                ['1', g.bgBottom],
              ] as const
            ).map(([offset, color]) => (
              <Stop key={offset} offset={offset} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#gatebg)" />
        {/* morning sun (light) / indigo heart (dark), top-right */}
        <Circle
          cx={width * 0.92}
          cy={height * 0.05}
          r={width * 0.34}
          fill={g.glow}
          opacity={g.glowOpacity}
        />
      </Svg>
      {animate ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: sway.translateX }, { translateY: sway.translateY }] },
          ]}
        >
          {DOORS.map((door, i) => (
            <DoorLayer key={door.name} door={door} index={i} centerY={centerY} />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

const DOOR_W = 196;
const DOOR_H = 276;

const styles = StyleSheet.create({
  doorLayer: {
    position: 'absolute',
    left: '50%',
    marginLeft: -DOOR_W / 2,
    width: DOOR_W,
    height: DOOR_H,
  },
  door: {
    flex: 1,
    borderWidth: 3,
    borderTopLeftRadius: 98,
    borderTopRightRadius: 98,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingBottom: 22,
    gap: 6,
  },
  lintel: {
    position: 'absolute',
    top: 14,
    left: 40,
    right: 40,
    height: 6,
    borderRadius: 6,
    opacity: 0.55,
  },
  roomTag: {
    position: 'absolute',
    top: 30,
    fontFamily: font.mono,
    fontSize: 8,
    letterSpacing: 2,
  },
  knob: {
    position: 'absolute',
    right: 12,
    top: '52%',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  icoWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  doorName: {
    fontFamily: font.serif,
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  doorLine: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    maxWidth: 150,
  },
  statChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 2,
  },
  statText: {
    fontFamily: font.mono,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
