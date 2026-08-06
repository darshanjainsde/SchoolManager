import { AccessibilityInfo } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Touchable } from '../Touchable';
import { Skeleton, SkeletonRow } from '../Skeleton';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

describe('anything you can tap', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ticks the phone the moment the finger lands, not when the work finishes', async () => {
    // The haptic confirms RECEIPT. One that waited for a round-trip would be
    // confirming something the person had already stopped wondering about.
    render(
      <Touchable testID="t" onPress={() => undefined}>
        <Text>Tap</Text>
      </Touchable>,
    );
    fireEvent(screen.getByTestId('t'), 'pressIn');
    await waitFor(() => expect(Haptics.impactAsync).toHaveBeenCalledWith('light'));
  });

  it('still runs the action', () => {
    const onPress = jest.fn();
    render(
      <Touchable testID="t" onPress={onPress}>
        <Text>Tap</Text>
      </Touchable>,
    );
    fireEvent.press(screen.getByTestId('t'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('stays silent where a tick on every tap would be noise', () => {
    render(
      <Touchable testID="t" haptic="none" onPress={() => undefined}>
        <Text>Row</Text>
      </Touchable>,
    );
    fireEvent(screen.getByTestId('t'), 'pressIn');
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('never fires for a disabled control — it would promise something false', () => {
    render(
      <Touchable testID="t" disabled onPress={() => undefined}>
        <Text>Off</Text>
      </Touchable>,
    );
    fireEvent(screen.getByTestId('t'), 'pressIn');
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('survives a device with no haptic engine rather than crashing the tap', async () => {
    (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('no engine'));
    const onPress = jest.fn();
    render(
      <Touchable testID="t" onPress={onPress}>
        <Text>Tap</Text>
      </Touchable>,
    );
    fireEvent(screen.getByTestId('t'), 'pressIn');
    fireEvent.press(screen.getByTestId('t'));
    expect(onPress).toHaveBeenCalled();
  });

  it('keeps the haptic under Reduce Motion — it is not motion', async () => {
    // Reduce Motion is about movement on screen. Removing the one non-visual
    // confirmation would make the app harder for the people who turned it on.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    render(
      <Touchable testID="t" onPress={() => undefined}>
        <Text>Tap</Text>
      </Touchable>,
    );
    fireEvent(screen.getByTestId('t'), 'pressIn');
    await waitFor(() => expect(Haptics.impactAsync).toHaveBeenCalled());
  });
});

describe('the skeleton', () => {
  it('is invisible to a screen reader — empty shapes are worse than silence', () => {
    render(<Skeleton width={40} height={10} testID="sk" />);
    expect(screen.queryByTestId('sk')).toBeNull();
    expect(screen.getByTestId('sk', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders a row shaped like the row it stands in for', () => {
    render(<SkeletonRow testID="row" />);
    expect(screen.getByTestId('row', { includeHiddenElements: true })).toBeTruthy();
  });
});
