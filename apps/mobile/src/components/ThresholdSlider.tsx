import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import { DUR, play, useReduceMotion } from '@/theme/motion';
import { font } from '@/theme/tokens';
import { useTokens } from '@/theme/theme-context';

const THUMB = 22;

interface ThresholdSliderProps {
  value: number;
  min?: number;
  max?: number;
  /** Granularity of a drag AND of one assistive-technology nudge. */
  step?: number;
  onChange: (next: number) => void;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * A continuous benchmark slider, hand-built.
 *
 * WHY IT EXISTS AT ALL (rather than a stepper): the pitch's whole argument for
 * this control is that the benchmark is a LINE YOU SLIDE — the class re-splits
 * under your thumb, so a teacher discovers where the meaningful break in their
 * class actually falls instead of accepting a number someone else rounded.
 * Discrete chips can only ever answer "how many are below 75?"; a slider
 * answers "where does this class fall apart?", which is the question the
 * histogram behind it is drawn to provoke.
 *
 * WHY IT IS HAND-BUILT: the app ships through EAS with a fixed native module
 * set, and `@react-native-community/slider` is a native view — adding one
 * would change the build contract for a control that is, in the end, a
 * horizontal drag. `PanResponder` (touch → value) plus `Animated` (value →
 * pixels) is entirely JS, so this stays a pure-JS screen.
 *
 * WHY THE FILL IS AN INK LINE: the filled portion of the track is the app's
 * ink-line gesture — the benchmark is being RULED onto the page, not a
 * generic progress bar. During a drag the ink follows the thumb with no
 * easing at all (a lagging fill under your own finger reads as dropped
 * input); it eases only when the value is changed from somewhere else — an
 * assistive-technology nudge — where the movement is the only feedback that
 * anything happened. Reduce-motion snaps in both cases.
 */
export function ThresholdSlider({
  value,
  // 0-100, so the filled portion always equals the number beside it: a track
  // that starts at 50 puts 75% at its midpoint and contradicts its own label.
  min = 0,
  max = 100,
  step = 1,
  onChange,
  testID,
  accessibilityLabel,
}: ThresholdSliderProps) {
  const tokens = useTokens();
  const reduced = useReduceMotion();
  const [width, setWidth] = useState(0);

  // Refs, not state, for everything the PanResponder reads: the responder is
  // created once (recreating it mid-gesture would drop the touch), so it must
  // never close over a stale render's props.
  const widthRef = useRef(0);
  const dragging = useRef(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const pos = useRef(new Animated.Value((value - min) / (max - min))).current;

  useEffect(() => {
    const to = (value - min) / (max - min);
    if (dragging.current || reduced.current) {
      pos.setValue(to);
      return;
    }
    const anim = play(pos, DUR.press, { native: true, toValue: to });
    // Stopped on unmount so a half-finished ease cannot outlive the screen.
    return () => anim?.stop();
  }, [value, min, max, pos, reduced]);

  const emit = (next: number) => {
    const clamped = Math.max(min, Math.min(max, Math.round(next / step) * step));
    if (clamped === valueRef.current) return;
    valueRef.current = clamped;
    onChangeRef.current(clamped);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Once the thumb is being dragged the gesture belongs to it — the
        // screen is a ScrollView, and letting the scroll view steal the touch
        // mid-drag would make the benchmark impossible to set with a thumb.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          dragging.current = true;
          if (widthRef.current > 0) {
            emit(min + Math.max(0, Math.min(1, e.nativeEvent.locationX / widthRef.current)) * (max - min));
          }
        },
        onPanResponderMove: (e) => {
          if (widthRef.current <= 0) return;
          emit(min + Math.max(0, Math.min(1, e.nativeEvent.locationX / widthRef.current)) * (max - min));
        },
        onPanResponderRelease: () => {
          dragging.current = false;
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
        },
      }),
    // `emit` is stable in behaviour (it reads refs); min/max/step are the only
    // real inputs, and they never change in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step],
  );

  const nudge = (dir: 1 | -1) => emit(valueRef.current + dir * step);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View
        testID={testID}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max, now: value, text: `${value} percent` }}
        accessibilityActions={[
          { name: 'increment', label: 'Raise the benchmark' },
          { name: 'decrement', label: 'Lower the benchmark' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') nudge(1);
          if (e.nativeEvent.actionName === 'decrement') nudge(-1);
        }}
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
        }}
        // A 6px track is not a 44pt target; the row is tall enough to grab
        // anywhere along it, and hitSlop covers the rest.
        hitSlop={{ top: 12, bottom: 12 }}
        style={{ flex: 1, height: 28, justifyContent: 'center' }}
        {...pan.panHandlers}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 11,
            height: 6,
            borderRadius: 3,
            backgroundColor: tokens.color.surfaceMuted,
            // The ink is a full-width bar SLID into view behind this mask,
            // rather than a bar whose width is animated: width is a layout
            // property (a re-layout every frame of a drag), a slide is a
            // transform the UI thread can own. The mask also keeps the ink's
            // rounded cap a circle instead of stretching it.
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: '100%',
              borderRadius: 3,
              backgroundColor: tokens.color.indigo,
              transform: [
                { translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [-Math.max(1, width), 0] }) },
              ],
            }}
          />
        </View>
        <Animated.View
          style={{
            position: 'absolute',
            top: 3,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: tokens.color.surface,
            borderWidth: 2.5,
            borderColor: tokens.color.indigo,
            shadowColor: tokens.color.ink,
            shadowOpacity: 0.2,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
            transform: [
              {
                // The thumb's CENTRE tracks the finger, so its box overhangs
                // each end by half its width — the parent leaves room for it.
                translateX: pos.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-THUMB / 2, Math.max(0, width - THUMB / 2)],
                }),
              },
            ],
          }}
        />
      </View>
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 16,
          fontWeight: '700',
          color: tokens.color.late,
          minWidth: 44,
          textAlign: 'right',
        }}
      >
        {value}%
      </Text>
    </View>
  );
}
