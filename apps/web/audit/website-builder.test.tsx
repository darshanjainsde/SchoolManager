/**
 * THE WEBSITE BUILDER, MEASURED.
 *
 * Two halves of one feature, in one document, because they fail differently:
 *
 *  - the PUBLIC page a school builds out of blocks, where the defects are
 *    overflow and clipping (a full-bleed picture, a fee table with six
 *    columns, a file name longer than the card);
 *  - the EDITOR RAIL a school builds it in, where the defects are tap targets
 *    (a 12px ✕, a 14px checkbox) inside a column that is 340–400px on a
 *    desktop and the whole screen on a phone.
 *
 * Both halves render the REAL components with realistic content, per the
 * ledger: hand-written markup that imitates a component has proved three times
 * that it can pass while the shipped screen is broken.
 *
 *   pnpm --filter @skoolos/web audit:screens
 *   then open audit/measure.html?file=./website-builder.html
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/font/local', () => ({
  default: ({ variable }: { variable: string }) => ({ className: variable.replace('--f-', 'f-'), variable, style: { fontFamily: variable } }),
}));

import PublicSite from '@/components/public/PublicSite';
import { BlockPalette, BlockRow, newBlock, type Block } from '@/app/app/website/block-editor';
import { PAGE_BLOCK_MAX, type PageBlock } from '@/components/public/site-variants';
import type { PublicSiteData } from '@/lib/public-api';
import { appCss } from './app-css';
import { siteData } from './public-site-render.test';

const noop = () => {};
const M = 'https://x.supabase.co/storage/v1/object/public/m';

/** The longest realistic values a school types, per the three questions. */
const LONG_FILE = 'Transport route map and bus-stop timings for the 2027–28 session';
const LONG_LINK = 'the admissions office on the first floor of the Vaishali Nagar block';

/** One of every block, at its defaults — what a school gets by clicking down the palette. */
const EVERY: PageBlock[] = [
  { t: 'h', text: 'Transport' },
  { t: 'p', text: 'Buses leave the school gate at 2:45 pm sharp. A child who misses the bus waits in the office until a parent arrives — we never send a child home alone.' },
  { t: 'img', url: `${M}/bus.jpg`, caption: 'The senior-wing fleet, parked at the Vaishali Nagar gate' },
  { t: 'imgtext', url: `${M}/driver.jpg`, text: 'Every driver holds a commercial licence and is re-verified each July. **Shri Ramesh Chandra Shekhawat** has driven Route 4 since 2011.' },
  { t: 'quote', text: 'My daughter has never once come home late, in six years.', by: 'Mrs Saanvi Krishnamurthy, parent, Class 8-B' },
  { t: 'callout', text: 'Route changes for the new session are published on 15 June. Tell the office before 31 May if your address has changed.' },
  { t: 'divider' },
  { t: 'table', header: true, rows: [
    ['Route', 'Stops', 'Leaves school', 'Fee per term'],
    ['1 — Vaishali Nagar', 'Gandhi Path, Queens Road, Amrapali Circle', '2:45 pm', '₹ 4,800'],
    ['2 — Mansarovar', 'Shipra Path, Madhyam Marg', '2:45 pm', '₹ 5,200'],
    ['3 — Jhotwara', 'Kalwar Road, Niwaru Phatak', '2:50 pm', '₹ 5,200'],
  ] },
  { t: 'file', url: 'https://cdn.example.com/route-map-2027.pdf', label: LONG_FILE, note: 'PDF · 1.2 MB' },
  { t: 'cta', label: 'Ask about a seat on a route', href: '/contact' },
];

/** Every OPTION at its extreme — the combinations a school reaches for and nobody tested. */
const EXTREMES: PageBlock[] = [
  { t: 'h', text: 'Fees and scholarships for the 2027–28 session', align: 'CENTER' },
  { t: 'p', text: 'Fees are billed per term. A sibling studying in the same session pays 10% less, and the Founder’s Scholarship covers the whole year.', align: 'CENTER' },
  { t: 'img', url: `${M}/campus.jpg`, caption: 'The Vaishali Nagar campus from the playing field', width: 'FULL' },
  { t: 'img', url: `${M}/poster.jpg`, caption: 'The scholarship poster, in full', width: 'COLUMN', fit: 'CONTAIN', align: 'CENTER' },
  { t: 'h', text: 'What a term costs', level: 3, align: 'RIGHT' },
  { t: 'p', text: 'Every figure below includes the examination fee.', align: 'RIGHT' },
  // Six columns and fourteen rows: the widest and longest a table may be.
  { t: 'table', header: true, rows: [
    ['Class', 'Tuition', 'Transport', 'Books & uniform', 'Examination', 'Total per term'],
    ...Array.from({ length: 13 }, (_, i) => [
      `Class ${i + 1}${i === 11 ? ' — Science' : ''}`,
      '₹ 18,400', '₹ 5,200', '₹ 3,150', '₹ 900', '₹ 27,650',
    ]),
  ] },
  { t: 'callout', text: 'The last date to pay without a late fee is **10 July 2027**.', tone: 'WARN' },
  { t: 'callout', text: 'Nineteen children held a Founder’s Scholarship last session.', tone: 'GOOD' },
  { t: 'divider', style: 'DOTS' },
  { t: 'divider', style: 'SPACE' },
  { t: 'file', url: 'https://cdn.example.com/fee-structure-2027-28-all-classes-nursery-to-twelve.pdf', label: 'Fee structure 2027–28 — nursery to Class 12, with the scholarship form', note: 'PDF · 840 KB' },
  { t: 'cta', label: 'Download the scholarship form', href: 'https://cdn.example.com/form.pdf', style: 'GHOST', align: 'RIGHT' },
  { t: 'cta', label: 'Talk to the accounts office', href: '/contact', align: 'CENTER' },
  { t: 'imgtext', url: `${M}/office.jpg`, text: 'The accounts office is open Monday to Saturday, 8:30 am to 1 pm.', flip: true },
];

/** The marks a school types, including the ones meant to be refused. */
const MARKS: PageBlock[] = [
  { t: 'h', text: 'How to apply' },
  { t: 'p', text: 'Collect a form from [' + LONG_LINK + '](/contact) or **download it** and bring it back *signed by both parents*.' },
  { t: 'p', text: '- Birth certificate, original and one photocopy\n- The report card of the last class passed\n- Four passport photographs of the child\n- Aadhaar of both parents\n- A transfer certificate, if the child is coming from another school' },
  { t: 'p', text: '1. Fill the form and attach the papers above\n2. Pay the ₹ 500 registration fee at the accounts window\n3. Bring the child in for an informal chat\n4. Collect the offer letter within seven working days' },
  { t: 'p', text: 'Write to [office@raffles.edu.in](mailto:office@raffles.edu.in) or call [+91 141 2345678](tel:+911412345678).' },
  // Refused links keep their words rather than losing the sentence.
  { t: 'p', text: 'A form typed with [a script link](javascript:alert) still reads as a sentence.' },
  { t: 'p', text: '**A whole paragraph in bold, because a school will write one, and it has to stay inside its column rather than pushing the page sideways on a phone.**' },
];

const pageOf = (title: string, slug: string, blocks: PageBlock[]) => ({ slug, title, blocks: blocks as unknown[] });

const PUBLIC_PANELS: { name: string; data: PublicSiteData; page: ReturnType<typeof pageOf> }[] = [
  { name: 'page · one of every block', data: siteData(), page: pageOf('Transport', 'transport', EVERY) },
  { name: 'page · every option at its extreme', data: siteData(), page: pageOf('Fees', 'fees', EXTREMES) },
  { name: 'page · the marks a school types', data: siteData(), page: pageOf('Admissions', 'how-to-apply', MARKS) },
  {
    name: 'page · dressed for a festival',
    data: siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment: 'HERO' } } }),
    page: pageOf('Transport', 'transport', EVERY),
  },
  { name: 'page · nothing written yet', data: siteData(), page: pageOf('Scholarships', 'scholarships', []) },
];

/** A filled editor row per block type — what the rail holds while a school works. */
const FILLED: Block[] = EVERY.map((b) => b as Block);
const PHOTOS = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, url: `${M}/g${i}.jpg` }));

function editorRow(b: Block, i: number, total: number) {
  return <BlockRow b={b} index={i} total={total} photos={PHOTOS} onChange={noop} onMove={noop} onRemove={noop} />;
}

it('writes audit/website-builder.html — the real builder, both halves', () => {
  const panels: [string, string][] = [];

  for (const p of PUBLIC_PANELS) {
    panels.push([
      p.name,
      renderToStaticMarkup(<PublicSite data={p.data} view="page" page={p.page as never} birthdays={null} records={null} />),
    ]);
  }

  // ── The rail. Wrapped exactly as studio-tab wraps it: the console's token
  //    scope, and the real 340–400px desktop column that is full width on a
  //    phone. A control measured in an unconstrained div is not measured.
  const rail = (inner: string) => `<div class="skosx audit-rail"><div class="flex flex-col gap-2.5 rounded-lg border border-teal-200 bg-teal-50/40 p-3">${inner}</div></div>`;

  panels.push([
    'editor · one row per block, filled',
    rail(FILLED.map((b, i) => renderToStaticMarkup(editorRow(b, i, FILLED.length))).join('')),
  ]);

  const EMPTY = (['h', 'p', 'img', 'imgtext', 'cta', 'divider', 'quote', 'callout', 'file', 'table'] as const).map((t) => newBlock(t));
  panels.push([
    'editor · one row per block, empty',
    rail(EMPTY.map((b, i) => renderToStaticMarkup(editorRow(b, i, EMPTY.length))).join('')),
  ]);

  const wide: Block = { t: 'table', header: true, rows: (EXTREMES.find((b) => b.t === 'table') as Extract<PageBlock, { t: 'table' }>).rows };
  panels.push(['editor · a table at 6 columns × 14 rows', rail(renderToStaticMarkup(editorRow(wide, 0, 1)))]);

  panels.push([
    'editor · the palette, and the palette full',
    rail(
      renderToStaticMarkup(<BlockPalette count={0} onAdd={noop} />) +
        renderToStaticMarkup(<BlockPalette count={PAGE_BLOCK_MAX} onAdd={noop} />),
    ),
  ]);

  const body = panels
    .map(([name, html]) => `<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${html}</section>`)
    .join('\n');

  writeFileSync(
    resolve(process.cwd(), 'audit/website-builder.html'),
    `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0;background:#fff}
/* No side padding on the page: a school's site has none, and a full-bleed
   block must be measured against the viewport it really spans. */
.audit-panel{margin:0 0 30px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px;padding:0 10px}
.audit-rail{box-sizing:border-box;width:min(100%,400px);padding:0 10px}</style>
</head><body><div>${body}</div></body></html>`,
  );

  console.log(`wrote audit/website-builder.html — ${body.length} bytes of real builder markup`);
  expect(body.length).toBeGreaterThan(40_000);
  // The harness must really have reached the new blocks, or a CLEAN means nothing.
  for (const marker of ['ps-pg-img-full', 'ps-pg-tablewrap', 'ps-pg-callout-warn', 'ps-pg-div-dots', 'ps-pg-file', 'ps-pg-quote', 'ps-pg-right', 'ps-cta-ghost', '+ Callout']) {
    expect(body, `the harness should render ${marker}`).toContain(marker);
  }
});
