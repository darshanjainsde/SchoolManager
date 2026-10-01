/**
 * EVERY CONTROL IN THE WEBSITE BUILDER CLEARS A FINGER.
 *
 * The measured audit found eleven controls in the builder under 24px: three
 * glyph buttons on every block row, the table's remove-row button, the four
 * reorder/delete buttons in the homepage and custom-page lists, the three
 * hero-slot buttons, and every checkbox.
 *
 * They are all one of two shapes now — `ICON_BTN` for a glyph button and
 * `.sk-check` for a checkbox — so this reads the source and refuses a third.
 * The rendered size of both is measured in audit/website-builder.html; this
 * only stops a new control being written at the old size.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = __dirname;
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.tsx'));
const src = (f: string) => readFileSync(resolve(DIR, f), 'utf8');

describe('the builder has one icon button and one checkbox', () => {
  it('no checkbox sets its own size, and none is left at the browser default', () => {
    for (const f of FILES) {
      const s = src(f);
      const boxes = s.split('type="checkbox"').slice(1);
      for (const after of boxes) {
        // The props of this one element — up to the tag's end.
        const el = after.slice(0, Math.max(after.indexOf('/>'), 0) || 400);
        expect(el, `${f}: a checkbox must carry .sk-check`).toContain('sk-check');
        expect(el, `${f}: .sk-check owns the size, so no h-/w- beside it`).not.toMatch(/\bh-[0-9.]+\s+w-[0-9.]+/);
      }
    }
  });

  it('no glyph button is sized by its text padding', () => {
    // `px-1 text-xs` around a ▲ measured 17x16. `ICON_BTN` is 24x24.
    for (const f of FILES) {
      expect(src(f), `${f}: use ICON_BTN for a glyph button`).not.toMatch(/className="(?:rounded )?p[xy]?-[0-5](?:\.5)? text-xs text-(?:slate|rose|white)/);
    }
  });

  it('ICON_BTN really is 24px square', () => {
    expect(src('block-editor.tsx')).toMatch(/export const ICON_BTN = '[^']*\bh-6\b[^']*\bw-6\b/);
  });
});

describe('the console checkbox grows for a thumb', () => {
  it('sets the size on the box, because a checkbox ignores padding', () => {
    const theme = readFileSync(resolve(DIR, '../../sk-theme.css'), 'utf8');
    const i = theme.indexOf('.sk-check { ');
    expect(i).toBeGreaterThan(-1);
    const coarse = theme.slice(i, i + 400);
    expect(coarse).toMatch(/@media \(pointer: coarse\), \(max-width: 640px\)/);
    expect(coarse).toMatch(/\.sk-check \{ width: 24px; height: 24px; margin: -4px; \}/);
  });
});
