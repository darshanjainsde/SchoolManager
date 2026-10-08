import { fireEvent, render, screen } from '@testing-library/react-native';
import { Chip, ChipRow } from '../Chip';

/**
 * The one chip (UI v2). What the screens rely on: the label is the label
 * (never a "✓ " prefix), selection is in accessibilityState, a tick is drawn
 * only when selected, and a disabled chip does not fire.
 */
it('shows the plain label and reports selection through accessibilityState', () => {
  const onPress = jest.fn();
  render(<Chip label="V-C" selected onPress={onPress} testID="chip-vc" />);
  expect(screen.getByText('V-C')).toBeTruthy();
  expect(screen.queryByText(/✓/)).toBeNull();
  expect(screen.getByTestId('chip-vc').props.accessibilityState).toMatchObject({ selected: true });
  fireEvent.press(screen.getByTestId('chip-vc'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('an unselected chip reports selected: false and keeps the same label', () => {
  const { rerender } = render(<Chip label="XII-A" onPress={() => {}} testID="chip" />);
  expect(screen.getByTestId('chip').props.accessibilityState).toMatchObject({ selected: false });
  rerender(<Chip label="XII-A" selected onPress={() => {}} testID="chip" />);
  expect(screen.getByTestId('chip').props.accessibilityState).toMatchObject({ selected: true });
  // Selection never rewrites the label — the width must not jump on a tap.
  expect(screen.getByText('XII-A')).toBeTruthy();
});

it('a disabled chip neither fires nor reports as enabled', () => {
  const onPress = jest.fn();
  render(<Chip label="Other" disabled onPress={onPress} testID="chip" />);
  fireEvent.press(screen.getByTestId('chip'));
  expect(onPress).not.toHaveBeenCalled();
  expect(screen.getByTestId('chip').props.accessibilityState).toMatchObject({ disabled: true });
});

it('ChipRow wraps its chips with the Material gap', () => {
  render(
    <ChipRow testID="row">
      <Chip label="A" onPress={() => {}} />
      <Chip label="B" onPress={() => {}} />
    </ChipRow>,
  );
  const style = [screen.getByTestId('row').props.style].flat().reduce((a, s) => ({ ...a, ...s }), {});
  expect(style).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 });
});
