import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { PressPrintPortal } from './press-print-portal';
import { printPressSheets } from '@/lib/press';

/**
 * The blank-page bug, pinned.
 *
 * `BodyPrintPortal` gates on `useHydrated`, which is per-INSTANCE: a portal
 * that first mounts in the same commit as a print call renders `null` on that
 * commit and appears one render later. The certificate desk did exactly that
 * (issue → fetch snapshot → print) and Chrome printed an empty page for a
 * serial already burned into the register.
 *
 * `printPressSheets` now waits for the sheets to exist, frame by frame, and
 * refuses to open the dialog on nothing.
 */

/** Mounts a print portal and prints in the SAME commit — the exact race. */
function PrintsOnMount() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => { if (ready) printPressSheets(); }, [ready]);
  return ready ? <PressPrintPortal><p>THE SHEET</p></PressPrintPortal> : null;
}

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  // jsdom never fires `afterprint`, so the flag from a previous case would
  // otherwise linger (in a browser the 60s fallback clears it).
  document.body.classList.remove('press-printing');
  vi.spyOn(window, 'print').mockImplementation(() => {});
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
});
afterEach(() => vi.restoreAllMocks());

/** Runs the queued frames the way a browser would, one tick at a time. */
function flushFrames(n: number) {
  for (let i = 0; i < n; i += 1) {
    const queued = frames;
    frames = [];
    act(() => { queued.forEach((cb) => cb(performance.now())); });
  }
}

describe('printing right after mounting the portal', () => {
  it('does not print a blank page — it waits for the sheets to exist', () => {
    render(<PrintsOnMount />);

    // The commit that asked to print had NO container yet: nothing printed.
    expect(window.print).not.toHaveBeenCalled();

    // React's follow-up render mounts the portal; the next frame prints it.
    flushFrames(2);
    expect(document.getElementById('press-print')?.textContent).toContain('THE SHEET');
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('gives up rather than printing an empty container', () => {
    // No portal at all — the container never arrives.
    printPressSheets();
    flushFrames(40);
    expect(window.print).not.toHaveBeenCalled();
    expect(document.body.classList.contains('press-printing')).toBe(false);
  });
});
