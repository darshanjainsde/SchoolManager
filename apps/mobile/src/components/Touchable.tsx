import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * ANYTHING YOU CAN TAP SHOULD ANSWER BACK.
 *
 * A flat Pressable gives no sign it received the touch, so on a slow network
 * the only feedback is the screen changing — which can be a second later, and
 * reads as "did that work?". This scales to 0.97 on press-in and ticks the
 * phone, so the answer arrives before the server's does.
 *
 * The haptic fires on press-IN, not on the action completing: it confirms
 * receipt, and a tick that waited for a round-trip would be confirming
 * something the person had already stopped wondering about.
 *
 * Scale honours Reduce Motion. The haptic deliberately does NOT — reduce-motion
 * is about movement on screen, and taking away the one non-visual confirmation
 * would make the app harder to use for exactly the people who turned it on.
 */
export function Touchable({
  children,
  onPress,
  style,
  /** 'none' for rows where a tick on every scroll-tap would be noise. */
  haptic = 'light',
  disabled,
  testID,
  accessibilityLabel,
  accessibilityRole = 'button',
  /**
   * `false` when this is a large convenience target wrapped AROUND content
   * that already contains its own buttons — the "right now" hero on Home is
   * tappable as a whole, but Pressable defaults to `accessible: true`, which
   * on iOS collapses everything inside into one element and would hide the
   * "Take attendance" button from VoiceOver. Setting it false keeps the big
   * target for anyone touching the screen and leaves the real buttons
   * individually reachable for anyone who is not.
   */
  accessible,
  hitSlop,
  pressTranslateY = 0,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: ViewStyle;
  haptic?: 'light' | 'medium' | 'none';
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  accessible?: boolean;
  hitSlop?: number;
  /**
   * The pitch's raised-dome press (`:active{transform:translateY(2.5px)}`):
   * a control that is drawn LIFTED off the page travels DOWN under the
   * finger, not just smaller. 0 (default) keeps the plain scale-only press.
   * Honours Reduce Motion like the scale does.
   */
  pressTranslateY?: number;
}): React.JSX.Element {
  const scale = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled) setReduceMotion(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function to(value: number) {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
    if (pressTranslateY > 0) {
      Animated.spring(translateY, {
        toValue: value === 1 ? 0 : pressTranslateY,
        useNativeDriver: true,
        speed: 40,
        bounciness: 0,
      }).start();
    }
  }

  return (
    <Pressable
      testID={testID}
      accessible={accessible}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => {
        to(0.97);
        if (haptic !== 'none' && !disabled) {
          // Best effort: a device with no haptic engine must not crash a tap.
          void Haptics.impactAsync(
            haptic === 'medium'
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
          ).catch(() => undefined);
        }
      }}
      onPressOut={() => to(1)}
      onPress={onPress}
    >
      <Animated.View style={[style, { transform: [{ scale }, { translateY }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
