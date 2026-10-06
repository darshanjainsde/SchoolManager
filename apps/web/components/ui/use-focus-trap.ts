'use client';
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps focus inside an overlay while it is open: moves focus in on mount,
 * wraps Tab at either end, and closes on Escape.
 *
 * Lived inline in `DialogShell` until the Pay drawer needed the same thing
 * and — for one release — shipped without it, so Tab walked out of the panel
 * into the greyed page. One hook, so every overlay traps focus the same way.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  // Callers pass a fresh `onClose` on every render. It lives in a ref so the
  // listener is set up once and Escape still calls the LATEST one — putting it
  // in the effect deps re-ran the focus-in below on every parent re-render and
  // pulled focus off the field someone was typing in.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus moves in once per dialog ELEMENT, not once per render. Overlay mounts
  // its panel one render after the hook first runs (it portals after mount), so
  // this runs after every render and acts only when a new element has appeared.
  const focusedEl = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el === focusedEl.current) return;
    focusedEl.current = el;
    // An `autoFocus` field inside already has it: do not take it back to Close.
    if (!el.contains(document.activeElement)) el.querySelectorAll<HTMLElement>(FOCUSABLE)[0]?.focus();
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      // Read at key time: the element may mount after this effect first ran.
      const el = ref.current;
      if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [ref]);
}
