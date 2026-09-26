/**
 * Renders the REAL school site under each FULL festive takeover, so the pitch
 * shows what a school gets TODAY — the numbers in festive-contrast.test.tsx
 * made visible. Home + admissions, four festivals + none.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('next/font/google', () => {
  const face = (name: string) => () => ({ className: `f-${name}`, variable: `--f-${name}`, style: { fontFamily: name } });
  return { Inter: face('inter'), Fraunces: face('fraunces'), Poppins: face('poppins'), Nunito: face('nunito'), Playfair_Display: face('playfair'), Space_Grotesk: face('grotesk'), Montserrat: face('montserrat'), Lora: face('lora') };
});
import PublicSite from '@/components/public/PublicSite';
import { siteData } from './public-site-render.test';

const fest = (festival: string, treatment: string, extra: Record<string, unknown> = {}) =>
  ({ festival, treatment, ribbon: true, recolor: true, ...extra });

const CASES: [string, unknown, Record<string, unknown>][] = [
  ['none', null, {}],
  ['DIWALI · LAYER (diyas)', fest('DIWALI', 'LAYER', { variant: 'DIYAS' }), {}],
  ['DIWALI · CHROME', fest('DIWALI', 'CHROME'), {}],
  ['DIWALI · HERO', fest('DIWALI', 'HERO'), {}],
  ['DIWALI · HERO · full-bleed photo', fest('DIWALI', 'HERO'), { heroLayout: 'FULL_BLEED' }],
  ['DIWALI · WASH', fest('DIWALI', 'WASH'), {}],
  ['DIWALI · NIGHT', fest('DIWALI', 'NIGHT'), {}],
  ['NAVRATRI · HERO', fest('NAVRATRI', 'HERO'), {}],
  ['HOLI · WASH', fest('HOLI', 'WASH'), {}],
  ['EID · NIGHT', fest('EID', 'NIGHT'), {}],
  ['INDEPENDENCE · CHROME', fest('INDEPENDENCE', 'CHROME'), {}],
  ['DURGA · NIGHT', fest('DURGA', 'NIGHT'), {}],
  ['VASANT · WASH', fest('VASANT', 'WASH'), {}],
];

describe('look at the festive takeovers', () => {
  it('writes festive-look.html', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/public/ps-css.css'), 'utf8');
    const pages: string[] = [];
    for (const [label, festiveTheme, profile] of CASES) {
      const data = siteData({ profile: { festiveTheme, ...profile } });
      const html = renderToStaticMarkup(<PublicSite data={data} view="home" /> as ReactElement);
      pages.push(`<section class="look"><h1 class="look-h">${label}</h1>${html}</section>`);
    }
    writeFileSync(
      resolve(process.cwd(), 'audit/festive-look.html'),
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<style>${css}</style>
<style>body{margin:0}.look{position:relative;margin:0 0 80px;border-bottom:16px solid #000}
.look-h{position:sticky;top:0;z-index:99;margin:0;padding:6px 16px;background:#111;color:#fff;font:700 12px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
.reveal{opacity:1!important;transform:none!important;clip-path:none!important}
.ps-fx{position:absolute!important}</style>
</head><body>${pages.join('\n')}</body></html>`,
    );
    expect(pages.join('').length).toBeGreaterThan(20000);
  });
});
