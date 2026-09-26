import { describe, it, expect, vi } from 'vitest';

// site-theme reaches @/lib/fonts, which is next/font/google — a build-time-only
// API whose loaders are not functions outside `next build`. Nothing here needs
// a real font file, only each family resolving to something.
vi.mock('next/font/google', () => {
  const face = (name: string) => () => ({ className: `f-${name}`, variable: `--f-${name}`, style: { fontFamily: name } });
  return { Inter: face('inter'), Fraunces: face('fraunces'), Poppins: face('poppins'), Nunito: face('nunito'), Playfair_Display: face('playfair'), Space_Grotesk: face('grotesk'), Montserrat: face('montserrat'), Lora: face('lora') };
});
import type { CSSProperties } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { themeRootProps } from './site-theme';
import { contrastRatio } from './site-utils';
import { FESTIVALS, TREATMENTS, treatmentsFor } from './site-variants';

/**
 * THE CONTRAST GATE.
 *
 * Every festival × every treatment it offers × every surface a word can sit
 * on, measured with the same WCAG 2.1 arithmetic the site uses, through the
 * same resolver the page uses (themeRootProps) — not a re-implementation.
 *
 * The floors: heading ink 4.5:1 (AAA for large type — headings are ≥ 24px
 * bold), strong small text 7:1, body and muted copy 4.5:1, an accent used as
 * text 4.5:1, a label on a fill 4.5:1. The audit that preceded this found the shipped light takeovers at
 * 1.5–2.5:1 for accent-as-text; this test is what stops that shipping again.
 *
 * Proved by breaking it: setting Children's Day's yellow as --ps-accent-text
 * directly (bypassing textSafe) turns three rows red.
 */
const SCHOOLS: Array<{ name: string; brand: string; brand2: string }> = [
  { name: 'forest (default)', brand: '#2f6b4f', brand2: '#e8b04b' },
  { name: 'navy', brand: '#1e3a6e', brand2: '#f59e0b' },
  { name: 'maroon', brand: '#7a1c26', brand2: '#c9931a' },
  { name: 'mint (light brand)', brand: '#3ee6b0', brand2: '#ffffff' },
];

function site(brand: string, brand2: string, festiveTheme: unknown): PublicSiteData {
  return {
    school: { name: 'S', slug: 's', tier: 'PRO', features: [], timezone: 'Asia/Kolkata' },
    profile: { brandColorPrimary: brand, brandColorSecondary: brand2, festiveTheme } as never,
    homepage: null, stats: [], socialLinks: [], gallery: [], staff: [], courses: [],
    admissions: { steps: [], showFees: false, feeNote: null }, events: [],
  } as unknown as PublicSiteData;
}

const v = (style: CSSProperties, k: string) => (style as unknown as Record<string, string>)[k];

const floor = (label: string, fg: string, bg: string, min: number) => {
  const r = contrastRatio(fg, bg);
  expect(r, `${label}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`).toBeGreaterThanOrEqual(min);
};

describe('festive contrast gate — every festival × treatment × surface', () => {
  const cases: Array<[string, string, string]> = [];
  for (const f of FESTIVALS) for (const t of treatmentsFor(f)) for (const s of SCHOOLS) cases.push([f.value, t, s.name]);

  it.each(cases)('%s · %s · %s school', (festival, treatment, schoolName) => {
    const s = SCHOOLS.find((x) => x.name === schoolName)!;
    const { style } = themeRootProps(site(s.brand, s.brand2, { festival, treatment }));
    const paper = v(style, '--paper');
    const panel = v(style, '--ps-card-bg');
    floor('heading ink on paper', v(style, '--ink'), paper, 4.5);
    floor('heading ink on panel', v(style, '--ink'), panel, 4.5);
    floor('strong text on paper', v(style, '--ps-text-strong'), paper, 7);
    floor('body text on paper', v(style, '--ps-text'), paper, 4.5);
    floor('body text on panel', v(style, '--ps-text'), panel, 4.5);
    floor('muted text on paper', v(style, '--ps-muted'), paper, 4.5);
    floor('muted text on panel', v(style, '--ps-muted'), panel, 4.5);
    floor('accent as text on paper', v(style, '--ps-accent-text'), paper, 4.5);
    floor('second accent as text on paper', v(style, '--ps-accent2-text'), paper, 4.5);
    floor('label on primary fill', v(style, '--ps1-on'), v(style, '--ps1'), 4.5);
    floor('label on accent fill', v(style, '--ps2-on'), v(style, '--ps2'), 4.5);
    if (treatment === 'HERO') {
      // The first screen: the school's ink and the festival's accent must read on the band's DARKER stop.
      floor('ink on the hero band', v(style, '--ps-hero-ink'), v(style, '--ps-hero-b'), 4.5);
      floor('body text on the hero band', v(style, '--ps-hero-text'), v(style, '--ps-hero-b'), 4.5);
      floor('hero accent on the hero band', v(style, '--ps-hero-accent'), v(style, '--ps-hero-b'), 4.5);
      floor('label on the hero accent', v(style, '--ps-hero-accent-on'), v(style, '--ps-hero-accent'), 4.5);
    }
  });

  it('with no festival on, every token is the slate value the utility always was (muted excepted, see below)', () => {
    const { style } = themeRootProps(site('#2f6b4f', '#e8b04b', null));
    expect(v(style, '--ps-text-strong')).toBe('#1e293b');
    expect(v(style, '--ps-text')).toBe('#475569');
    // The one deliberate default change: muted copy walked from slate-500
    // (4.37:1 on cream) to the first shade that clears AA. Same hue.
    expect(contrastRatio(v(style, '--ps-muted'), '#f7f5ef')).toBeGreaterThanOrEqual(4.5);
    expect(v(style, '--ps-muted')).not.toBe('#64748b');
    expect(v(style, '--ps-faint')).toBe('#94a3b8');
    expect(v(style, '--ps-card-bg')).toBe('#ffffff');
    expect(v(style, '--paper')).toBe('#f7f5ef');
  });

  it('the five treatments are all exercised by the matrix above', () => {
    const seen = new Set(cases.map((c) => c[1]));
    for (const t of TREATMENTS) expect(seen.has(t.value)).toBe(true);
  });
});
