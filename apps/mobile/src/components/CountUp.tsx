import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Text, type TextStyle } from 'react-native';

/**
 * A FIGURE THAT ARRIVES.
 *
 * Counts from zero to `value` once, when it first lands. Used only where a
 * number is the ANSWER to something — the classes taught in a finished day, an
 * attendance percentage — and never on a figure that changes as you work: the
 * register's running count must track the tap that caused it, and a number
 * rolling up to catch a teacher's thumb would be slower than no animation at
 * all as well as wrong.
 *
 * It runs on state rather than `Animated`, because there is no animatable text
 * value in React Native — the digits themselves have to change. That is
 * affordable precisely because of the restriction above: a handful of figures,
 * once each, over half a second.
 *
 * Reduce Motion gets the final figure immediately. Nothing is lost — the number
 * was always the point, and the count was only ever how it arrived.
 *
 * The preference is READ, NOT ASSUMED. `useReduceMotion` hands back a ref filled
 * by a promise, which is fine for the six gestures because those fire on a later
 * user-driven transition — by then it has resolved. This decides at MOUNT, and
 * at mount that ref still says false, so the count would have run for exactly
 * the people who turned the setting on. It awaits the answer instead, and shows
 * the FINAL figure until it arrives: if the probe were ever slow, the failure is
 * a number that is simply correct.
 */
export function CountUp({
  value,
  /** ~0.6s: long enough to read as counting, short enough not to be waited on. */
  duration = 600,
  style,
  suffix = '',
  testID,
}: {
  value: number;
  duration?: number;
  style?: TextStyle;
  /** '%' for a percentage; the unit rides along so it never wraps alone. */
  suffix?: string;
  testID?: string;
}): React.JSX.Element {
  const [shown, setShown] = useState(value);
  // The figure this instance has already counted to. A re-render with the SAME
  // value must not replay the count — that is the difference between "this
  // just arrived" and a number that twitches every time its parent repaints,
  // which, now that the clock above it ticks every minute, is a real risk.
  const counted = useRef<number | null>(null);

  useEffect(() => {
    if (counted.current === value) return;
    counted.current = value;
    if (value <= 0) {
      setShown(value);
      return;
    }
    let id: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        setShown(value);
        return;
      }
      setShown(0);
      const started = Date.now();
      id = setInterval(() => {
        const t = Math.min(1, (Date.now() - started) / duration);
        // Ease-out: fast at first, settling onto the final figure, so the last
        // few digits are readable rather than a blur that stops abruptly.
        setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
        if (t >= 1) clearInterval(id);
      }, 40);
    });
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [value, duration]);

  return (
    <Text testID={testID} style={style}>
      {shown}
      {suffix}
    </Text>
  );
}
