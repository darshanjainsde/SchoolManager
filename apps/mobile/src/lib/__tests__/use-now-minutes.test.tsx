import { AppState, Text, type AppStateStatus } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { msToNextMinute, nowMinutes, useNowMinutes } from '../use-now-minutes';

let renders = 0;

function Clock() {
  renders += 1;
  const m = useNowMinutes();
  return <Text testID="m">{String(m)}</Text>;
}

function shown(): string {
  return screen.getByTestId('m').props.children as string;
}

/**
 * Sets the STARTING instant. Called exactly once per test, before render.
 *
 * Modern fake timers give timers and `Date.now()` a single shared clock, so
 * `advanceTimersByTime` moves the wall clock too. Re-freezing between advances
 * would therefore double-count the elapsed time and fire the same timer twice.
 * Every test below sets the clock once and then moves it only by advancing —
 * except the two backgrounding tests, which jump the clock WITHOUT advancing
 * precisely because that is what a suspended app looks like: time passed, the
 * timer never ran.
 */
function startAt(hh: number, mm: number, ss = 0, ms = 0) {
  jest.setSystemTime(new Date(2026, 7, 6, hh, mm, ss, ms));
}

/** Captures the AppState 'change' handlers this render subscribes with. */
function captureAppState(): { fire: (state: AppStateStatus) => void; restore: () => void } {
  const listeners: Array<(s: AppStateStatus) => void> = [];
  const spy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, handler: (s: AppStateStatus) => void) => {
      listeners.push(handler);
      return { remove: () => undefined } as never;
    });
  return {
    fire: (state) => act(() => listeners.forEach((l) => l(state))),
    restore: () => spy.mockRestore(),
  };
}

describe('the arithmetic, without a component', () => {
  it('counts minutes past midnight', () => {
    expect(nowMinutes(new Date(2026, 7, 6, 0, 0))).toBe(0);
    expect(nowMinutes(new Date(2026, 7, 6, 10, 35))).toBe(635);
    expect(nowMinutes(new Date(2026, 7, 6, 23, 59))).toBe(1439);
  });

  it('waits for the NEXT whole minute, not a flat 60 seconds', () => {
    // The distinction is the whole point: a flat interval started at :47 keeps
    // firing at :47 forever, so the live card flips 47 seconds after the bell.
    expect(msToNextMinute(new Date(2026, 7, 6, 10, 35, 0, 0))).toBe(60_000);
    expect(msToNextMinute(new Date(2026, 7, 6, 10, 35, 47, 0))).toBe(13_000);
    expect(msToNextMinute(new Date(2026, 7, 6, 10, 35, 59, 750))).toBe(250);
  });
});

describe('useNowMinutes', () => {
  beforeEach(() => {
    renders = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts at the current minute', () => {
    startAt(10, 35);
    render(<Clock />);
    expect(shown()).toBe('635');
  });

  it('flips at the bell, not 60 seconds after whenever it mounted', () => {
    startAt(10, 35, 40);
    render(<Clock />);
    expect(shown()).toBe('635');

    // 19.9s on: 10:35:59.9. Still the same period.
    act(() => jest.advanceTimersByTime(19_900));
    expect(shown()).toBe('635');

    // The remaining 100ms crosses 10:36:00 — twenty seconds after mount, not
    // sixty. A flat setInterval(60000) would still be showing 635 here.
    act(() => jest.advanceTimersByTime(100));
    expect(shown()).toBe('636');
  });

  it('keeps ticking, re-arming from the clock each time', () => {
    startAt(10, 35, 30);
    render(<Clock />);
    act(() => jest.advanceTimersByTime(30_000));
    expect(shown()).toBe('636');
    act(() => jest.advanceTimersByTime(60_000));
    expect(shown()).toBe('637');
    act(() => jest.advanceTimersByTime(60_000));
    expect(shown()).toBe('638');
  });

  it('re-reads the clock when the app comes back to the foreground', () => {
    // A phone in a pocket from registration to lunch. Timers do not run while
    // it is suspended, so the clock is jumped WITHOUT advancing them — the
    // return to foreground is the only thing that can correct the card.
    const app = captureAppState();
    startAt(9, 5);
    render(<Clock />);
    expect(shown()).toBe('545');

    startAt(13, 20);
    app.fire('active');
    expect(shown()).toBe('800');
    app.restore();
  });

  it('ignores background and inactive transitions', () => {
    const app = captureAppState();
    startAt(9, 5);
    render(<Clock />);
    startAt(13, 20);
    app.fire('background');
    app.fire('inactive');
    // Still the mount-time minute: only 'active' re-syncs.
    expect(shown()).toBe('545');
    app.restore();
  });

  it('does not re-render when the minute has not changed', () => {
    // The bail-out matters because this hook sits above the whole of Home: a
    // foreground event a few seconds after the last one must not repaint the
    // timeline, the day list and the notes panel for no reason.
    const app = captureAppState();
    startAt(9, 5, 10);
    render(<Clock />);
    const before = renders;

    startAt(9, 5, 55);
    app.fire('active');
    expect(shown()).toBe('545');
    expect(renders).toBe(before);
    app.restore();
  });

  it('clears its timer on unmount', () => {
    startAt(10, 35, 30);
    const view = render(<Clock />);
    view.unmount();
    act(() => jest.advanceTimersByTime(120_000));
    // A leaked timer would still be armed here, calling setState on a tree
    // that is gone.
    expect(jest.getTimerCount()).toBe(0);
  });
});
