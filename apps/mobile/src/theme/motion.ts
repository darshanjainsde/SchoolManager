import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * THE SIX GESTURES (Phase 5·4) — the motion vocabulary from the approved
 * pitches, which tracked each one by name in a live counter: the Tick, the
 * Highlight, the Ink Line, the Stamp, the Pin and the Signature.
 *
 * Every motion in this app should be one of the six. That is the point of
 * naming them: a diary is a paper object, and things happen to paper in a
 * small number of ways — you tick it, highlight it, rule a line under it,
 * stamp it, pin it up, or sign it. A bounce or a spinner belongs to a
 * different product.
 *
 * All six honour the OS "reduce motion" setting by snapping straight to the
 * finished state, so nothing here is load-bearing for comprehension: the
 * animation is how a change ARRIVES, never how it is understood.
 */

/** The pitch's shared easing, `cubic-bezier(.22,1,.36,1)` — a fast, settling ease-out. */
export const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** Durations, in ms, lifted from the pitch's keyframes. */
export const DUR = {
  /** `.press:active` — the tap acknowledgement. */
  press: 120,
  /** `tokin` — a student token popping into the picker. */
  token: 250,
  /** `drawt` — a tick stroking itself on. */
  tick: 450,
  /** `pinin` — an item dropping onto the page. */
  pin: 400,
  /** `stampin` — a stamp landing. */
  stamp: 450,
  /** `sigdraw` — a signature being written. */
  signature: 800,
  /** `inkgrow` / progress rules filling. */
  ink: 1400,
  /** `pendraw` — the logo's S drawing itself. */
  logo: 1200,
  /** Screen and sheet transitions. */
  screen: 300,
  /**
   * `.ntsheet` — the notification slip unfolding from under the bell. Its own
   * number (.28s) rather than `screen`/`pin`, because the pitch tunes it to
   * land just after the scrim has dimmed (.25s) so the paper reads as coming
   * forward OVER a page that has already stepped back.
   */
  slip: 280,
  /**
   * `@keyframes pulse` — one beat of the live dot on the teacher's "right
   * now" hero. Not one of the six gestures: the six all mark a change to the
   * page, and this marks nothing — it is a heartbeat saying the card is
   * describing the present tense, so it repeats forever and means nothing
   * when it stops.
   */
  pulse: 1800,
} as const;

/**
 * Tracks the OS reduce-motion preference, live. Returned as a ref so the
 * animation helpers can read it at fire time without re-rendering anything.
 */
export function useReduceMotion(): React.MutableRefObject<boolean> {
  const reduced = useRef(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) reduced.current = v;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduced.current = v;
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * Runs one gesture: drives `value` 0 → 1 over `duration`, or sets it
 * instantly when reduce-motion is on. `useNativeDriver` is the caller's
 * choice because a stroke-dash animation (SVG `strokeDashoffset`) cannot use
 * it, while a transform or opacity always should.
 */
export function play(
  value: Animated.Value,
  duration: number,
  opts: { reduced?: boolean; native?: boolean; delay?: number; toValue?: number } = {},
): Animated.CompositeAnimation | null {
  const to = opts.toValue ?? 1;
  if (opts.reduced) {
    value.setValue(to);
    return null;
  }
  const anim = Animated.timing(value, {
    toValue: to,
    duration,
    delay: opts.delay ?? 0,
    easing: EASE,
    useNativeDriver: opts.native ?? true,
  });
  anim.start();
  return anim;
}

/**
 * A gesture that runs once when `when` first becomes true, and stays
 * finished. The workhorse behind the Tick, the Stamp, the Pin and the
 * Signature — all of which mark a thing that has happened, so replaying them
 * on every re-render would be a lie about what just changed.
 */
export function useGesture(
  when: boolean,
  duration: number,
  opts: { native?: boolean; delay?: number } = {},
): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);
  const reduced = useReduceMotion();
  useEffect(() => {
    if (!when || fired.current) return;
    fired.current = true;
    play(value, duration, { reduced: reduced.current, native: opts.native, delay: opts.delay });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when]);
  return value;
}

/**
 * THE PIN — an item dropping onto the page: it arrives from above, slightly
 * askew, overshoots a touch and settles straight. The pitch's `pinin`:
 * `translateY(-10px) rotate(-2deg)` → `translateY(2px) rotate(.8deg)` at 60%
 * → resting. Used wherever something is ADDED to a page: a new diary line, a
 * posted announcement, a notice, the teacher's email-sent card.
 */
export function pinStyle(v: Animated.Value) {
  return {
    opacity: v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [-10, 2, 0] }) },
      {
        rotate: v.interpolate({
          inputRange: [0, 0.6, 1],
          outputRange: ['-2deg', '0.8deg', '0deg'],
        }),
      },
    ],
  };
}

/**
 * THE STAMP — a rubber stamp landing on finished work: it comes in oversized
 * and rotated, thumps down past its resting size and settles a few degrees
 * off square, the way a hand-held stamp never lands quite straight. The
 * pitch's `stampin`: `scale(1.6) rotate(-7deg)` → `scale(.95) rotate(-2deg)`
 * at 60% → `scale(1) rotate(-2deg)`. Used to CLOSE work: attendance saved,
 * marks entered, a request approved.
 */
export function stampStyle(v: Animated.Value) {
  return {
    opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] }),
    transform: [
      { scale: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1.6, 0.95, 1] }) },
      {
        rotate: v.interpolate({
          inputRange: [0, 0.6, 1],
          outputRange: ['-7deg', '-2deg', '-2deg'],
        }),
      },
    ],
  };
}

/**
 * THE TOKEN POP — a chosen student becoming a chip in the picker. The
 * pitch's `tokin`: `scale(.7)` + transparent → full size. Small and quick;
 * it exists so a tap on a name is visibly ACCEPTED, which is what stops a
 * teacher tapping twice.
 */
export function tokenStyle(v: Animated.Value) {
  return {
    opacity: v,
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
  };
}

/**
 * THE INK LINE — a rule drawing itself along, left to right: the progress of
 * a live class, an attendance percentage filling, a "seen by" bar. The
 * pitch's `inkgrow`/`.attink i` width transitions. Returns a width
 * percentage string, so the caller applies it to a bar's inner fill.
 */
export function inkWidth(v: Animated.Value, percent: number) {
  return v.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${Math.max(0, Math.min(100, percent))}%`],
  });
}

/**
 * THE HIGHLIGHT — a marker sweep behind text that matters, and the amber
 * wash a row gets when it is the live one. Interpolates opacity so a
 * highlight can fade in under content that is already on screen.
 */
export function highlightStyle(v: Animated.Value) {
  return { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) };
}

/**
 * THE SIGNATURE and THE TICK are both stroke-draw gestures on an SVG path:
 * the dash offset runs from the path's length to zero, so the line appears to
 * be written. They cannot use the native driver (`strokeDashoffset` is not a
 * transform), which is why `useGesture` takes `native: false` for them.
 *
 * `length` is the path's own dash length — 26 for the pitch's tick, 70 for
 * its signature.
 */
export function strokeDashoffset(v: Animated.Value, length: number) {
  return v.interpolate({ inputRange: [0, 1], outputRange: [length, 0] });
}

/** Dash lengths from the pitch, so callers don't re-measure the same paths. */
export const DASH = { tick: 26, signature: 70, logoS: 130, logoTassel: 12 } as const;
