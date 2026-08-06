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
