import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useTokens } from '@/theme/theme-context';

/**
 * THE SHAPE OF THE ANSWER, BEFORE THE ANSWER.
 *
 * A spinner says "something is happening"; a skeleton says "a list of four
 * pupils is coming". The second is worth more, and it stops the screen jumping
 * when real content lands in a space nothing was holding.
 *
 * Breathes at 1.6s — slow enough to read as waiting rather than as a fault.
 * Under Reduce Motion it holds still at mid-opacity, which still shows the
 * layout without pulsing.
 */
export function Skeleton({
  width,
  height,
  radius = 6,
  /** Stagger, so a list of rows arrives as a wave rather than one flat block. */
  index = 0,
  testID,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  index?: number;
  testID?: string;
}): React.JSX.Element {
  const tokens = useTokens();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 800, delay: index * 120, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.5, duration: 800, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
    };
  }, [pulse, index]);

  return (
    <Animated.View
      testID={testID}
      // A placeholder has nothing to announce, and reading a row of empty
      // shapes aloud would be worse than silence.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: tokens.color.surfaceMuted,
        opacity: pulse,
      }}
    />
  );
}

/**
 * A stand-in for one row of a list — avatar, two lines of text. Sized to the
 * real row so nothing shifts when the data lands.
 */
export function SkeletonRow({ index = 0, testID }: { index?: number; testID?: string }): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
      }}
    >
      <Skeleton width={32} height={32} radius={16} index={index} />
      <View style={{ flex: 1, gap: 5 }}>
        <Skeleton width="62%" height={9} index={index} />
        <Skeleton width="34%" height={8} index={index} />
      </View>
    </View>
  );
}
