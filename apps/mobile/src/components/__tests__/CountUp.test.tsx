import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { CountUp } from '../CountUp';

function shown(): string {
  return screen.getByTestId('n').props.children.join('');
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 6, 12, 0, 0));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Lets the reduce-motion probe resolve before assertions. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

it('starts at zero and lands exactly on the figure', async () => {
  render(<CountUp testID="n" value={28} duration={600} />);
  await settle();
  expect(shown()).toBe('0');

  act(() => {
    jest.advanceTimersByTime(600);
  });
  // Exactly 28 — an eased count that stopped at 27 would be a wrong number
  // dressed as a nice one.
  expect(shown()).toBe('28');
});

it('passes through the intervening figures rather than jumping', async () => {
  render(<CountUp testID="n" value={100} duration={600} />);
  await settle();
  act(() => {
    jest.advanceTimersByTime(300);
  });
  const mid = Number(shown());
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(100);
});

it('carries its unit so a percentage never wraps away from its number', async () => {
  render(<CountUp testID="n" value={92} suffix="%" />);
  await settle();
  act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(shown()).toBe('92%');
});

it('does not replay when its parent repaints with the same figure', async () => {
  // The difference between "this just arrived" and a number that twitches
  // every time something above it re-renders — which, now that the clock
  // ticks every minute, is something above it doing exactly that.
  const view = render(<CountUp testID="n" value={28} duration={600} />);
  await settle();
  act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(shown()).toBe('28');

  view.rerender(<CountUp testID="n" value={28} duration={600} />);
  expect(shown()).toBe('28');
});

it('counts again when the figure genuinely changes', async () => {
  const view = render(<CountUp testID="n" value={28} duration={600} />);
  await settle();
  act(() => {
    jest.advanceTimersByTime(600);
  });

  view.rerender(<CountUp testID="n" value={40} duration={600} />);
  // The reset lands only once the reduce-motion probe has answered — see the
  // note in CountUp.tsx for why that check happens before anything moves.
  await settle();
  expect(shown()).toBe('0');
  act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(shown()).toBe('40');
});

it('shows the figure immediately under Reduce Motion', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  render(<CountUp testID="n" value={28} duration={600} />);
  await settle();
  // Nothing is lost: the number was always the point, and the count was only
  // ever how it arrived.
  expect(shown()).toBe('28');
});

it('renders zero as zero, with nothing to count', async () => {
  render(<CountUp testID="n" value={0} />);
  await settle();
  expect(shown()).toBe('0');
});
