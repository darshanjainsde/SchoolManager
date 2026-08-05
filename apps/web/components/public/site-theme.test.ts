import { describe, it, expect, vi } from 'vitest';

// `site-theme` reads FONT_STACK for --font-head, and @/lib/fonts calls next/font's
// Inter() at module load — a build-time transform that throws under vitest and
// takes the WHOLE file down with "no tests". These assertions are about colours
// and classes, so the font module is stubbed rather than loaded.
vi.mock('@/lib/fonts', () => ({ fontVars: 'font-vars', FONT_STACK: { INTER: 'Inter, sans-serif' } }));
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { themeRootProps } from './site-theme';
import type { PublicSiteData } from '@/lib/public-api';

/**
 * ONE DEFINITION OF WHAT A SCHOOL LOOKS LIKE.
 *
 * The blog rendered outside the school's theme entirely — its own bare topbar,
 * none of the palette, none of the fonts — so a parent following a newsletter
 * link landed somewhere that could have belonged to any school in the network.
 * Fixing that by copying the theme computation would have guaranteed the two
 * drift apart, so there is one function and both surfaces call it.
 */
function site(profile: Partial<NonNullable<PublicSiteData['profile']>> = {}): PublicSiteData {
  return {
    school: { name: 'Raffles', slug: 'raffles', tier: 'PRO', features: [], timezone: 'Asia/Kolkata' },
    profile: { brandColorPrimary: '#123456', brandColorSecondary: '#abcdef', ...profile } as PublicSiteData['profile'],
    homepage: null,
    stats: [],
    socialLinks: [],
    gallery: [],
    staff: [],
    courses: [],
    admissions: { steps: [], showFees: false, feeNote: null },
    events: [],
  };
}

describe('the theme a page wears', () => {
  it('carries the school’s own two colours into the CSS variables', () => {
    const { style } = themeRootProps(site());
    expect(style).toMatchObject({ '--ps1': '#123456', '--ps2': '#abcdef' });
  });

  it('substitutes a lightened primary when the secondary is near-white', () => {
    // Two near-identical stops make every gradient on the page look broken.
    const { style } = themeRootProps(site({ brandColorSecondary: '#ffffff' }));
    expect(style['--ps2' as keyof typeof style]).not.toBe('#ffffff');
  });

  it('silences motion for a school that asked for none', () => {
    const { className } = themeRootProps(site({ animationLevel: 'NONE' }));
    expect(className).toContain('ps-motion-off');
  });

  it('adds no style class at all when every axis is at its default', () => {
    // This is what let three columns ship without repainting a single school.
    const { className } = themeRootProps(site());
    expect(className).not.toMatch(/ps-shape-|ps-gesture-|ps-texture-/);
  });

  it('carries every chosen axis onto the root together', () => {
    const { className } = themeRootProps(
      site({ sectionShape: 'CRISP', motionGesture: 'DRAW', backgroundTexture: 'GRID', headlineAccent: 'MARKER' }),
    );
    for (const cls of ['ps-shape-crisp', 'ps-gesture-draw', 'ps-texture-grid', 'ps-accent-marker']) {
      expect(className).toContain(cls);
    }
  });
});

describe('the blog wears the school, not nobody', () => {
  const blogIndex = readFileSync(join(__dirname, '../../app/blog/page.tsx'), 'utf8');
  const blogPost = readFileSync(join(__dirname, '../../app/blog/[slug]/page.tsx'), 'utf8');

  it.each([
    ['the index', () => blogIndex],
    ['a post', () => blogPost],
  ])('%s renders inside the school chrome', (_name, read) => {
    expect(read()).toContain('SchoolChrome');
  });

  it.each([
    ['the index', () => blogIndex],
    ['a post', () => blogPost],
  ])('%s no longer ships its own bare topbar', (_name, read) => {
    // The old "← Home / Blog" bar was the giveaway that this page belonged to
    // no school. The real SiteNav replaces it, with the school's own menu.
    expect(read()).not.toContain('blog-topbar');
  });
});
