import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A SHAPE CONTROL IS ONLY WORTH THE PLACES IT REACHES.
 *
 * The whole point of section shape is that ONE control changes everything below
 * the fold. A band that draws its own `rounded-3xl` panel is a band the control
 * cannot reach — the school picks Editorial, most of the page goes ruled, and
 * one stubborn section stays a pillowy card. That is worse than not offering
 * the control at all, because it reads as a bug rather than a choice.
 *
 * So: below the fold, a panel is `.ps-panel`. The hero and the nav are NOT in
 * this list on purpose — they sit above the fold, they already have seven
 * layouts and five styles of their own, and the plan scopes shape to what is
 * below.
 */
const BELOW_THE_FOLD = [
  'sections/AcademicsSection.tsx',
  'sections/AdmissionsSection.tsx',
  'sections/ConnectSection.tsx',
  'sections/ContactSection.tsx',
  'sections/EventsSection.tsx',
  'sections/GallerySection.tsx',
  // Alumni is a full SiteView of its own, entirely below the fold. It was
  // absent from this list while it was being built, which is how it came to
  // carry eight hardcoded `rounded-full` pills that no shape could reach.
  'sections/AlumniSection.tsx',
];

function source(rel: string): string {
  return readFileSync(join(__dirname, rel), 'utf8');
}

describe('every band below the fold answers to the shape control', () => {
  it.each(BELOW_THE_FOLD)('%s draws its panels with .ps-panel', (rel) => {
    expect(source(rel)).toContain('ps-panel');
  });

  it.each(BELOW_THE_FOLD)('%s hardcodes no panel radius of its own', (rel) => {
    // rounded-3xl / rounded-2xl / rounded-[2rem] are panel-sized corners. The
    // small ones (rounded-xl and below) are pills, inputs and chips — those are
    // inner chrome, not panels, and shape deliberately leaves them alone.
    const offenders = source(rel).match(/rounded-(3xl|2xl|\[2rem\])/g) ?? [];
    expect(offenders).toEqual([]);
  });

  it.each(BELOW_THE_FOLD)('%s does not pin its own drop shadow', (rel) => {
    // ps-soft and shadow-xl are the SOFT look hardcoded. A school that picked
    // Crisp asked for no shadow, and it has to actually get none.
    const offenders = source(rel).match(/\bps-soft\b|shadow-(xl|2xl|lg)/g) ?? [];
    expect(offenders).toEqual([]);
  });
});

describe('the shapes are real systems, not three radius values', () => {
  const CSS = source('ps-css.ts');

  it('drives every panel from tokens, so one class redefines all of them', () => {
    expect(CSS).toMatch(/\.ps-panel\s*\{[^}]*border-radius:\s*var\(--ps-radius\)/);
    expect(CSS).toMatch(/\.ps-panel\s*\{[^}]*box-shadow:\s*var\(--ps-card-shadow\)/);
  });

  it('makes Editorial boxless — no fill, no shadow, a rule instead of a corner', () => {
    const editorial = CSS.slice(CSS.indexOf('.ps-shape-editorial'));
    expect(editorial).toMatch(/--ps-card-bg:\s*transparent/);
    expect(editorial).toMatch(/--ps-card-shadow:\s*none/);
    expect(editorial).toMatch(/border-top:\s*2px solid var\(--ps1\)/);
  });

  it('makes Crisp bordered rather than floated', () => {
    const crisp = CSS.slice(CSS.indexOf('.ps-shape-crisp'));
    expect(crisp).toMatch(/--ps-card-shadow:\s*none/);
    expect(crisp).toMatch(/--ps-card-border:\s*1px solid/);
  });

  it('leaves the hero’s own cards alone — .ps-card is not .ps-panel', () => {
    // The hero's floating cards wear .ps-card. If shape were hung off that
    // class instead, picking Editorial would put a rule through the hero.
    expect(source('sections/HeroSection.tsx')).not.toContain('ps-panel');
  });
});

/**
 * ONE RECIPE FOR A BUTTON OF WEIGHT.
 *
 * The site had exactly one real call-to-action — "Enquire now" — assembled at
 * its single call site from six Tailwind utilities. Nothing named that recipe,
 * so the next eight buttons were rebuilt by eye from `.ps-btn`, which sets a
 * radius and a shadow and NO PADDING AT ALL. They rendered as cramped little
 * pills beside the confident one, which is exactly how it was reported.
 *
 * These assertions are cheap and they are the reason it cannot happen twice.
 */
describe('a call to action is a class, not six utilities', () => {
  const CSS = source('ps-css.ts');

  it('gives .ps-cta its own padding, so a bare .ps-cta is never cramped', () => {
    expect(CSS).toMatch(/\.ps-cta\s*\{[^}]*padding:/);
    expect(CSS).toMatch(/\.ps-cta\s*\{[^}]*font-weight:/);
  });

  it('takes the CTA corner from the shape token, not a fixed pill', () => {
    expect(CSS).toMatch(/\.ps-cta\s*\{[^}]*border-radius:\s*var\(--ps-radius-sm\)/);
  });

  it('drops the CTA shadow for the two shapes that asked for none', () => {
    expect(CSS).toMatch(/\.ps-shape-editorial \.ps-cta[^{]*\{[^}]*box-shadow:\s*none/);
    expect(CSS).toMatch(/\.ps-shape-crisp \.ps-cta[^{]*\{[^}]*box-shadow:\s*none/);
  });

  it('offers a contrast fill whose legibility does not depend on a school choice', () => {
    // --ps2 is the school's accent and may be a pale marigold that cannot
    // carry white text. Ink is the colour the site already trusts to be read.
    expect(CSS).toMatch(/\.ps-cta-ink\s*\{[^}]*background:\s*var\(--ink\)/);
  });

  it('keeps a segmented item legible BEFORE it is selected', () => {
    // The washed-out version tinted the item 12% of the brand hue and then set
    // its text to that same hue — almost no chroma separation, so the row read
    // as a smudge. The track carries the tint now; the label wears ink.
    expect(CSS).toMatch(/\.ps-seg-btn\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--ink\)/);
    expect(CSS).toMatch(/\.ps-seg\s*\{[^}]*background:\s*color-mix/);
  });

  it('drives the selected item from aria-pressed, so state cannot drift from style', () => {
    expect(CSS).toMatch(/\.ps-seg-btn\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--ps1\)/);
  });

  it('leaves no hand-rolled chip selector behind in the alumni section', () => {
    const src = source('sections/AlumniSection.tsx');
    expect(src).not.toContain('ps-chip px-4 py-2 rounded-full');
    expect(src).not.toContain('ps-btn ps-cta-btn');
    // The inline active override the segmented control replaced.
    expect(src).not.toContain("borderColor: 'var(--ps1)'");
  });
});

describe('a brand fill never assumes its label is white', () => {
  const CSS = source('ps-css.ts');

  it('takes the CTA label from the resolved token', () => {
    // Beacon's brand is a mint; white on it measures 1.6:1. Hardcoding #fff
    // made every primary button on that school's site unreadable.
    expect(CSS).toMatch(/\.ps-cta-1\s*\{[^}]*color:\s*var\(--ps1-on/);
    expect(CSS).toMatch(/\.ps-cta-btn\s*\{[^}]*color:\s*var\(--ps1-on/);
  });

  it('takes the selected segment label from it too', () => {
    expect(CSS).toMatch(/\.ps-seg-btn\[aria-pressed="true"\]\s*\{[^}]*color:\s*var\(--ps1-on/);
  });

  it('keeps a track hugging its contents, at any length', () => {
    // .ps-seg-wrap set display:flex, which made the track block-level: the
    // batch row stretched the full page with four chips at its left end.
    expect(CSS).not.toMatch(/\.ps-seg-wrap\s*\{/);
    expect(CSS).toMatch(/\.ps-seg\s*\{[^}]*display:\s*inline-flex/);
    expect(CSS).toMatch(/\.ps-seg\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it('leaves no stretched track behind in the alumni section', () => {
    expect(source('sections/AlumniSection.tsx')).not.toContain('ps-seg-wrap');
  });
});
