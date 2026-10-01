/**
 * THE FOUR RULES A PAGE OF BLOCKS STANDS ON.
 *
 * Every one of these is here because the measured audit of 2026-10-01 caught
 * it on a 390px screen, and because no DOM test could have: the markup was
 * correct and the geometry was wrong. They are asserted against the
 * stylesheet because that is where the defect lived.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, 'ps-css.css'), 'utf8');

/** The declaration body of a single-selector rule. */
function rule(selector: string): string {
  const i = CSS.indexOf(`${selector} {`);
  expect(i, `${selector} should exist in ps-css.css`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf('}', i));
}

describe('the blocks column', () => {
  it('declares its own track, so no block can size it', () => {
    // `display: grid` with no template gives ONE auto track, sized from its
    // widest item's contribution. `.ps-pg-img-full` contributes 100vw plus a
    // percentage margin resolved against that same track, and Chrome settled
    // on a 592px track inside a 342px column — which moved the full-bleed
    // picture 125px off the left edge, shrank a centred picture to 166px and
    // grew the fee table to 563px, where `.ps-root`'s overflow-x CLIPPED it
    // rather than letting it scroll.
    expect(rule('.ps-pgblocks')).toMatch(/grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)/);
  });

  it('is centred in the page, which is what makes a full bleed reach the edges', () => {
    // `calc(50% - 50vw)` only lands on the viewport's edge when the column's
    // own centre IS the viewport's centre. Left-aligned in a wider box, the
    // breakout was off by exactly how far the column sat from centre.
    expect(rule('.ps-pgblocks')).toMatch(/margin-inline:\s*auto/);
  });
});

describe('a picture inside the column', () => {
  it('fills the column up to its cap instead of shrink-wrapping', () => {
    // A grid item with auto margins and no declared width stops stretching
    // and takes its content's width: a centred COLUMN picture measured 166px
    // against a 416px cap.
    const r = rule('.ps-pg-img-column');
    expect(r).toMatch(/width:\s*100%/);
    expect(r).toMatch(/max-width:\s*26rem/);
  });
});

describe('a table', () => {
  it('scrolls inside itself and can be narrower than its contents', () => {
    const r = rule('.ps-pg-tablewrap');
    expect(r).toMatch(/overflow-x:\s*auto/);
    expect(r).toMatch(/min-width:\s*0/);
  });
});

describe('a link inside a sentence', () => {
  it('has a thumb-sized hit area without changing the line', () => {
    // Vertical padding on an inline box grows the target and leaves the line
    // box alone: 19px of ink, 27px of target.
    expect(CSS).toMatch(/\.ps-pg-link\s*\{[^}]*padding-block:\s*\.25rem/);
  });
});
