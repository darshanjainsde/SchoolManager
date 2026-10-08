import { fireEvent, render, screen } from '@testing-library/react-native';
import { Stepper } from '../Stepper';

/**
 * ‹ value › (UI v2). The screens' tests press `${testID}-prev/-next` and read
 * `${testID}-value`, so the fan-out is the contract; the arrows must clear
 * the 44 dp floor and a disabled arrow must not fire.
 */
it('fans the testID out to prev / value / next and steps on press', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  render(<Stepper value="8 Oct 2026" onPrev={onPrev} onNext={onNext} testID="assign-due" />);
  expect(screen.getByTestId('assign-due-value')).toHaveTextContent('8 Oct 2026');
  fireEvent.press(screen.getByTestId('assign-due-prev'));
  fireEvent.press(screen.getByTestId('assign-due-next'));
  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
});

it('each arrow is a 44 dp tile with a spoken label', () => {
  render(<Stepper value="09:15" onPrev={() => {}} onNext={() => {}} testID="t" prevLabel="Earlier" nextLabel="Later" />);
  const prev = screen.getByTestId('t-prev');
  const style = typeof prev.props.style === 'function' ? prev.props.style({ pressed: false }) : prev.props.style;
  expect([style].flat().reduce((a, s) => ({ ...a, ...s }), {})).toMatchObject({ width: 44, height: 44 });
  expect(prev.props.accessibilityLabel).toBe('Earlier');
  expect(screen.getByTestId('t-next').props.accessibilityLabel).toBe('Later');
});

it('a disabled arrow dims and does not fire', () => {
  const onNext = jest.fn();
  render(<Stepper value="today" onPrev={() => {}} onNext={onNext} nextDisabled testID="d" />);
  fireEvent.press(screen.getByTestId('d-next'));
  expect(onNext).not.toHaveBeenCalled();
  expect(screen.getByTestId('d-next').props.accessibilityState).toMatchObject({ disabled: true });
});

it('the value uses tabular figures so it does not jitter as it changes', () => {
  render(<Stepper value="12:45" onPrev={() => {}} onNext={() => {}} testID="v" />);
  const style = [screen.getByTestId('v-value').props.style].flat().reduce((a, s) => ({ ...a, ...s }), {});
  expect(style.fontVariant).toEqual(['tabular-nums']);
});
