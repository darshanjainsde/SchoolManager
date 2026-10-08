import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, TextInput } from 'react-native';

/**
 * KEYBOARD HOOKS FOR ANDROID SCREENS.
 *
 * Making room for the keyboard is NOT done here: it is native, in
 * plugins/with-keyboard-insets.js (the activity's content pads by the
 * keyboard, which is what adjustResize did before edge-to-edge). These hooks
 * only let a screen react once that room exists. They rely on React Native's
 * keyboard events, which that padding makes fire again on Android 16.
 */

/**
 * True while the software keyboard is up. The tab bars use it to step aside:
 * a teacher typing a note needs those 64 dp for the note, not for four
 * buttons they cannot reach without closing the keyboard anyway.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * A conversation keeps its newest line in sight when the keyboard opens.
 * The frame shrinks the transcript from the BOTTOM, which is exactly where
 * the message being answered was — so when the transcript gets shorter,
 * scroll it to its end. Spread the result onto the ScrollView.
 */
export function usePinToEnd(scrollRef: React.RefObject<{ scrollToEnd?: (o?: { animated?: boolean }) => void } | null>) {
  const lastHeight = useRef(0);
  return {
    onLayout: (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (lastHeight.current > 0 && h < lastHeight.current) scrollRef.current?.scrollToEnd?.({ animated: true });
      lastHeight.current = h;
    },
  };
}

/**
 * Room kept below the focused box when the keyboard opens: enough for the
 * button that belongs to it (a 44 dp "Add note" / "Send" plus its gap).
 * Android scrolls only the box itself into view, which left those buttons
 * cut in half by the keyboard on Notes and Diary (emulator, 2026-10-08).
 */
export const ROOM_BELOW_FOCUSED = 96;

/**
 * How far to scroll so the focused box has ROOM_BELOW_FOCUSED dp of space
 * under it inside the visible part of the scroller — without pushing the
 * box's own top out of view. All values in window dp. Pure, so it is tested
 * on numbers rather than on a device.
 */
export function scrollToShowFocused(box: { top: number; bottom: number }, view: { top: number; bottom: number }, room = ROOM_BELOW_FOCUSED): number {
  const want = box.bottom + room - view.bottom;
  if (want <= 0) return 0;
  const maxBeforeTopLeaves = box.top - view.top - 8;
  return Math.max(0, Math.min(want, maxBeforeTopLeaves));
}

type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };
type Scrollable = Measurable & { scrollTo?: (o: { y: number; animated?: boolean }) => void };

/**
 * When the keyboard opens, nudge the screen's scroller so the focused box
 * AND the button under it are both above the keyboard. Spread the result
 * onto the ScrollView / FlatList (it tracks the scroll offset it needs).
 */
export function useKeepFocusedInView(scrollRef: React.RefObject<Scrollable | null>) {
  const offset = useRef(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      // After the frame the native pad shrank the scroller in.
      requestAnimationFrame(() => {
        const input = TextInput.State.currentlyFocusedInput() as Measurable | null;
        const scroller = scrollRef.current;
        if (!input?.measureInWindow || !scroller?.measureInWindow || !scroller.scrollTo) return;
        input.measureInWindow((_x, y, _w, h) => {
          scroller.measureInWindow!((_sx, sy, _sw, sh) => {
            const by = scrollToShowFocused({ top: y, bottom: y + h }, { top: sy, bottom: sy + sh });
            if (by > 0) scroller.scrollTo!({ y: offset.current + by, animated: true });
          });
        });
      });
    });
    return () => sub.remove();
  }, [scrollRef]);
  return {
    scrollEventThrottle: 16,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
  };
}
