import { Keyboard, Platform } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { scrollToShowFocused, useKeyboardVisible, usePinToEnd } from '../keyboard';
import { PortalTabBar } from '@/components/PortalTabBar';
import { VISIBLE_TABS } from '@/lib/staff-nav';

/**
 * The hooks screens use once the native pad (plugins/with-keyboard-insets.js)
 * has made room for the keyboard. Keyboard events are driven by hand; that
 * they really fire on Android 16 is proven on the emulator, not here.
 */
type Listener = (e: { endCoordinates: { screenY: number; height: number } }) => void;
let listeners: Record<string, Listener[]> = {};
const emit = (name: string, screenY = 0) =>
  act(() => {
    for (const l of listeners[name] ?? []) l({ endCoordinates: { screenY, height: 0 } });
  });

const realOS = Platform.OS;
beforeEach(() => {
  listeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, l: Listener) => {
    (listeners[name] ??= []).push(l);
    return { remove: () => { listeners[name] = (listeners[name] ?? []).filter((x) => x !== l); } };
  }) as never);
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});

describe('useKeyboardVisible + the tab bar', () => {
  const tabs = VISIBLE_TABS as never;
  const props: Record<string, unknown> = {
    tabs,
    state: { index: 0, routes: VISIBLE_TABS.map((t) => ({ key: t.name, name: t.name })) },
    navigation: { navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  };

  it('the bar steps aside while the keyboard is up and comes back after', () => {
    const { queryByText } = render(<PortalTabBar {...(props as never as Parameters<typeof PortalTabBar>[0])} />);
    expect(queryByText(VISIBLE_TABS[0].title)).toBeTruthy();
    emit('keyboardDidShow', 600);
    expect(queryByText(VISIBLE_TABS[0].title)).toBeNull();
    emit('keyboardDidHide');
    expect(queryByText(VISIBLE_TABS[0].title)).toBeTruthy();
  });

  it('reports visibility', () => {
    let seen: boolean[] = [];
    function Probe() {
      seen.push(useKeyboardVisible());
      return null;
    }
    render(<Probe />);
    emit('keyboardDidShow', 600);
    emit('keyboardDidHide');
    expect(seen[0]).toBe(false);
    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
    seen = [];
  });
});

describe('usePinToEnd', () => {
  it('scrolls a conversation to its newest line when the keyboard makes it shorter — and only then', () => {
    const scrollToEnd = jest.fn();
    const ref = { current: { scrollToEnd } };
    let pin: ReturnType<typeof usePinToEnd> | undefined;
    function Probe() {
      pin = usePinToEnd(ref);
      return null;
    }
    render(<Probe />);
    const layout = (height: number) => pin!.onLayout({ nativeEvent: { layout: { height } } });
    layout(700); // first layout: nothing to compare with
    expect(scrollToEnd).not.toHaveBeenCalled();
    layout(380); // keyboard opened
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
    scrollToEnd.mockClear();
    layout(700); // keyboard closed: the reader's place is left alone
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});

describe('scrollToShowFocused', () => {
  const view = { top: 80, bottom: 555 }; // the part of the screen above the keyboard

  it('leaves the screen alone when the box and its button already fit', () => {
    expect(scrollToShowFocused({ top: 200, bottom: 300 }, view)).toBe(0);
  });

  it('scrolls just enough for the button under the box (Notes: the box fitted, "Add note" was cut)', () => {
    // box ends 40 dp above the keyboard; the button needs 96
    expect(scrollToShowFocused({ top: 425, bottom: 515 }, view)).toBe(56);
  });

  it('never pushes the top of a tall box out of view to make room', () => {
    // a 400 dp note box: only 32 dp of scroll keeps its top 8 dp below the view's top
    expect(scrollToShowFocused({ top: 120, bottom: 520 }, view)).toBe(32);
  });

  it('is 0 rather than negative for a box above the view', () => {
    expect(scrollToShowFocused({ top: 40, bottom: 600 }, view)).toBe(0);
  });
});
