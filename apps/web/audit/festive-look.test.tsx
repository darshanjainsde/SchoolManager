/**
 * Renders the REAL school site under every festival's every scene, so the
 * scenes can be LOOKED AT (audit/festive-look.html) before they ship. HERO for
 * every scene, then the night and full-bleed cases that stress the dress.
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

import { FESTIVALS } from '@/components/public/site-variants';

const CASES: [string, unknown, Record<string, unknown>][] = [
  ['none', null, {}],
  ...FESTIVALS.flatMap((f) => f.variants.map((v): [string, unknown, Record<string, unknown>] => [`${f.value} · ${v.value} · HERO`, fest(f.value, 'HERO', { variant: v.value }), {}])),
  ['DIWALI · DEEPAVALI · NIGHT', fest('DIWALI', 'NIGHT'), {}],
  ['DIWALI · LAKSHMI · NIGHT', fest('DIWALI', 'NIGHT', { variant: 'LAKSHMI' }), {}],
  ['EID · SKYLINE · NIGHT', fest('EID', 'NIGHT', { variant: 'SKYLINE' }), {}],
  ['CHRISTMAS · TREE · NIGHT', fest('CHRISTMAS', 'NIGHT'), {}],
  ['JANMASHTAMI · KRISHNA · NIGHT', fest('JANMASHTAMI', 'NIGHT', { variant: 'KRISHNA' }), {}],
  ['DIWALI · DEEPAVALI · HERO · full-bleed photo', fest('DIWALI', 'HERO'), { heroLayout: 'FULL_BLEED' }],
  ['GANESH · MURTI · WASH · split', fest('GANESH', 'WASH'), { heroLayout: 'SPLIT' }],
  ['HOLI · SPLASH · LAYER · pill nav', fest('HOLI', 'LAYER'), { navStyle: 'PILL' }],
  ['NAVRATRI · DUSSEHRA · CHROME', fest('NAVRATRI', 'CHROME', { variant: 'DUSSEHRA' }), {}],
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
</style>
</head><body>${pages.join('\n')}</body></html>`,
    );
    expect(pages.join('').length).toBeGreaterThan(20000);
  });
});
