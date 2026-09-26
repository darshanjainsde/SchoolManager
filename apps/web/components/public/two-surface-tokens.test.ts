import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(__dirname, 'ps-css.css'), 'utf8');

/**
 * THE TWO-SURFACE FLOOR, PINNED.
 *
 * Words below the fold are Tailwind slate utilities in ~100 places. The
 * stylesheet remaps them, inside .ps-root only, to tokens themeRootProps sets
 * — which is the whole reason a festival can retint a page without a hundred
 * edits. These checks make sure (1) the remap exists for every class the
 * sections use, (2) the fallbacks are the exact slate values so a page with no
 * festival repaints nothing, and (3) the dress can be stopped.
 */
describe('two-surface tokens', () => {
  it('remaps every slate text utility the sections use, inside .ps-root only', () => {
    for (const cls of ['text-slate-900', 'text-slate-800', 'text-slate-700', 'text-slate-600', 'text-slate-500', 'text-slate-400', 'bg-white']) {
      expect(CSS, cls).toMatch(new RegExp(`\\.ps-root \\.${cls.replace('/', '\\/')}[^{]*\\{[^}]*var\\(--ps-`));
    }
  });
  it('falls back to the exact slate values, so a school with no festival on repaints nothing', () => {
    expect(CSS).toMatch(/--ps-text-strong: #1e293b/);
    expect(CSS).toMatch(/--ps-text: #475569/);
    expect(CSS).toMatch(/--ps-muted: #64748b/);
    expect(CSS).toMatch(/--ps-faint: #94a3b8/);
  });
  it('never remaps text-white — it belongs to the coloured bands that bring their own fill', () => {
    expect(CSS).not.toMatch(/\.ps-root \.text-white\b/);
  });
});

describe('the festive dress is light and stoppable', () => {
  it('uses gradients for the lights, not filters or images', () => {
    const dress = CSS.slice(CSS.indexOf('Festive treatments (2026-09)'), CSS.indexOf('Studio additions: motion kill-switches'));
    expect(dress).toContain('radial-gradient');
    expect(dress).not.toMatch(/url\(/);
    expect(dress).not.toMatch(/\bfilter:\s*blur/);
    expect(dress).not.toMatch(/backdrop-filter/);
  });
  it('animates only opacity and transform, and stops under Animation = Off and reduced-motion', () => {
    const dress = CSS.slice(CSS.indexOf('Festive treatments (2026-09)'), CSS.indexOf('Studio additions: motion kill-switches'));
    expect(dress).toMatch(/\.ps-motion-off \.ps-fest-bulb, \.ps-motion-off \.ps-fest-flame \{ animation: none; \}/);
    expect(dress).toMatch(/prefers-reduced-motion: reduce\) \{ \.ps-fest-bulb, \.ps-fest-flame \{ animation: none; \}/);
    for (const kf of dress.matchAll(/@keyframes [^{]+\{([^}]*\}[^}]*)\}/g)) {
      expect(kf[1]).not.toMatch(/\b(width|height|top|left|margin|background)\s*:/);
    }
  });
  it('scopes the HERO band\u2019s accent and ink to #home, so the page below keeps the school\u2019s', () => {
    expect(CSS).toMatch(/\.ps-fest-hero #home \{[^}]*--ps1: var\(--ps-hero-accent\)/);
    expect(CSS).toMatch(/\.ps-fest-hero #home \{[^}]*--ink: var\(--ps-hero-ink\)/);
    expect(CSS).not.toMatch(/\.ps-fest-dress ~ \*/); // a sibling rule here re-positioned the photo layer once
  });
});
