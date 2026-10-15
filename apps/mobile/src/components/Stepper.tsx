import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { Icon } from './icons';
import { useTokens } from '@/theme/theme-context';

/**
 * A VALUE WITH A ‹ AND A › (UI v2, 2026-10-08).
 *
 * Due date, test date, test time, a day in the diary: the app steps these
 * with two arrows round a value. Before this each screen drew its own — bare
 * "‹" glyphs with no box and no 48 dp target in three places, 44 dp in one.
 * Now: two 44 dp tiles (hitSlop makes 48), the value between them at 15/600
 * in tabular figures so it does not jitter as the number changes, and the
 * arrow dims (not hides) when it cannot go further.
 *
 * `testID` fans out to `${testID}-prev`, `${testID}-value`, `${testID}-next`,
 * which is what every screen's test already presses.
 */
export function Stepper({
  value,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  prevLabel = 'Previous',
  nextLabel = 'Next',
  testID,
  minWidth = 112,
  style,
}: {
  value: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  testID?: string;
  minWidth?: number;
  style?: ViewStyle;
}) {
  const tokens = useTokens();
  const c = tokens.color;
  const tile = (dir: 'prev' | 'next', disabled: boolean | undefined, onPress: () => void, label: string) => (
    <Pressable
      testID={testID ? `${testID}-${dir}` : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: tokens.radius.field,
        backgroundColor: c.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
      })}
    >
      <View style={{ transform: [{ scaleX: dir === 'next' ? -1 : 1 }] }}>
        <Icon name="chevron" size={20} color={c.indigo} />
      </View>
    </Pressable>
  );
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }, style]}>
      {tile('prev', prevDisabled, onPrev, prevLabel)}
      <Text
        testID={testID ? `${testID}-value` : undefined}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ minWidth, textAlign: 'center', fontSize: 15, lineHeight: 20, fontWeight: '600', color: c.ink, fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
      {tile('next', nextDisabled, onNext, nextLabel)}
    </View>
  );
}
