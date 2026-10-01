/**
 * EVERY NAV STYLE STAYS ON SCREEN WHILE THE PAGE SCROLLS.
 *
 * CLASSIC, STRIP, CENTER and the off-photo PILL are `position: sticky`. A
 * sticky element sticks to its nearest SCROLL CONTAINER, and `overflow-x:
 * hidden` on .ps-root made it one (hidden on one axis computes the other to
 * auto). .ps-root never scrolls — the window does — so those bars scrolled
 * away with the page and only the `fixed` bars (photo-homepage PILL, GHOST)
 * behaved. No DOM test sees it: the header's classes were right, and the
 * ancestor broke it. So it is asserted where the defect lived.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, 'ps-css.css'), 'utf8');

/** Every declaration body for a selector, across all its rules. */
function bodies(selector: string): string[] {
  const out: string[] = [];
  let i = CSS.indexOf(`${selector} {`);
  while (i > -1) {
    out.push(CSS.slice(i, CSS.indexOf('}', i)));
    i = CSS.indexOf(`${selector} {`, i + 1);
  }
  return out;
}

/** The value a browser that supports `clip` ends up with: the LAST one wins. */
function lastOverflow(body: string, axis: 'x' | 'y' | null): string | null {
  const prop = axis ? `overflow-${axis}` : 'overflow';
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`, 'g');
  let last: string | null = null;
  for (const m of body.matchAll(re)) last = m[1].trim();
  return last;
}

describe('the page root never becomes a scroll container', () => {
  it('trims horizontal spill with clip, not hidden', () => {
    const root = bodies('.ps-root');
    expect(root.length).toBeGreaterThan(0);
    const winners = root.map((b) => lastOverflow(b, 'x')).filter(Boolean);
    expect(winners.length, '.ps-root should still trim horizontal overflow').toBeGreaterThan(0);
    for (const v of winners) expect(v).toBe('clip');
  });

  it('sets no scrolling overflow on either axis', () => {
    for (const body of bodies('.ps-root')) {
      for (const axis of [null, 'y'] as const) {
        const v = lastOverflow(body, axis);
        if (v) expect(['visible', 'clip']).toContain(v);
      }
    }
  });
});
