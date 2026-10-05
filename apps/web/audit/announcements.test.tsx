// @vitest-environment jsdom
/* eslint-disable react/jsx-key -- panels are mounted one at a time, never as siblings */
//
// Renders the REAL announcements desk with resolved data and writes the
// settled DOM to audit/announcements.html for the browser to measure at
// 360 / 390 / 414 / 768 / 1024 / 1280 / 1440 / 1920.
//
// The fixtures are the numbers a real school reaches, per the
// ui-mistake-ledger: 26 notices (one of them sent to FIFTEEN classes, which
// is fifteen rows out of the API), 45 class sections in the picker, a title
// that is a whole sentence and a message with blank lines in it.
import { it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import AnnouncementsPage from '@/app/app/announcements/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const GRADES = ['Nursery', 'LKG', 'UKG', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const SECTIONS = ['A', 'B', 'C'];

const CLASSES = GRADES.flatMap((g, gi) =>
  SECTIONS.map((s, si) => ({
    id: `cs-${gi}-${si}`,
    name: s,
    grade: { name: g },
    academicYear: { isCurrent: true },
    _count: { students: 24 + ((gi * 3 + si) % 17) },
  })),
);

const LONG_TITLE = 'Half-Yearly Examination 2026-27 — revised date sheet and reporting time for Classes IX to XII';
const LONG_BODY =
  'The revised date sheet is on the notice board and in the app.\n\n'
  + 'Students must report at 8:15 am and carry the school identity card. '
  + 'Mobile phones are not allowed inside the examination hall.\n\n'
  + 'Parents of students appearing for the practical examination should check the laboratory timings separately.';

const at = (day: number, ms = 0) =>
  new Date(Date.UTC(2026, 8, day, 9, 0, 0, ms)).toISOString();

/** One notice to fifteen classes = fifteen rows, which is what the API sends. */
const WIDE = GRADES.slice(0, 15).map((g, i) => ({
  id: `wide-${i}`,
  title: LONG_TITLE,
  body: LONG_BODY,
  classSectionId: `cs-${i}-1`,
  classSection: { name: 'B', grade: { name: g } },
  createdAt: at(30, i * 40),
}));

const OTHERS = Array.from({ length: 25 }, (_, i) => ({
  id: `n-${i}`,
  title: [
    'Gandhi Jayanti — school closed',
    'Parent–Teacher Meeting on Saturday',
    'Inter-house sports day',
    'Library period begins this week',
    'Fee reminder for Term 2',
  ][i % 5],
  body: 'The school will remain closed on Friday, 2 October. Classes resume on Monday as usual.',
  classSectionId: i % 3 === 0 ? null : `cs-${i % 15}-0`,
  classSection: i % 3 === 0 ? null : { name: 'A', grade: { name: GRADES[i % 15] } },
  createdAt: at(28 - (i % 25)),
}));

const ROWS = [...WIDE, ...OTHERS];
let rows = ROWS;

beforeEach(() => {
  rows = ROWS;
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p.startsWith('/manage/announcements')) return rows;
      if (p.startsWith('/manage/classes')) return CLASSES;
      return [];
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
    download: vi.fn(), postForm: vi.fn(),
  } as never);
});

type Step = (host: HTMLElement) => void;

/**
 * Mounts a screen, settles its queries, then applies each step with a settle
 * in between — a drawer has to exist before the control inside it can be
 * pressed. Returns the page markup and, separately, whatever portalled to
 * <body>: the overlay is NOT inside the host, which is the whole point of it,
 * and splicing it inline is how an earlier harness hid half of what it
 * claimed to measure.
 */
async function run(node: React.ReactNode, steps: Step[] = []): Promise<{ html: string; portal: string }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(host);
  const settle = async () => {
    let prev = '';
    for (let i = 0; i < 10 && document.body.innerHTML !== prev; i += 1) {
      prev = document.body.innerHTML;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
  };
  await act(async () => { root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  await settle();
  for (const step of steps) {
    await act(async () => { step(host); });
    await settle();
  }
  const portal = [...document.body.children]
    .filter((el) => el !== host && el.querySelector('.sk-panel'))
    .map((el) => el.outerHTML)
    .join('');
  const html = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return { html, portal };
}

const byText = (label: string | RegExp): Step => (host) => {
  const match = (t: string) => (typeof label === 'string' ? t === label : label.test(t));
  const root = [...document.querySelectorAll('.sk-panel')].pop() ?? host;
  const btn = [...root.querySelectorAll('button')].find((b) => match((b.textContent ?? '').trim()));
  btn?.click();
};

it('writes the real announcements desk for a browser to measure', async () => {
  const panels: [string, Step[]][] = [
    ['Announcements', []],
    ['Announcements — reading one', [(host) => (host.querySelector('.sk-rowline[data-clickable]') as HTMLElement)?.click()]],
    ['Announcements — writing one', [byText(/New announcement/)]],
    // Through to a CHOSEN state: the pressed chips, and the line that says how
    // many families that actually is, are the part worth looking at.
    ['Announcements — choosing classes', [byText(/New announcement/), byText('Chosen classes'), byText('IX')]],
    ['Announcements — about to delete', [
      (host) => (host.querySelector('.sk-rowline[data-clickable]') as HTMLElement)?.click(),
      byText('Delete'),
    ]],
  ];

  const parts: string[] = [];
  const portals: string[] = [];
  for (const [name, steps] of panels) {
    const { html, portal } = await run(<AnnouncementsPage />, steps);
    expect(html.length, name).toBeGreaterThan(500);
    parts.push(`<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${html}</section>`);
    if (portal) portals.push(`<div class="audit-panel" data-panel="${name}">${portal}</div>`);
  }

  rows = [];
  const { html: empty } = await run(<AnnouncementsPage />);
  parts.push(`<section class="audit-panel" data-panel="Announcements — nothing posted yet"><h2 class="audit-h">Announcements — nothing posted yet</h2>${empty}</section>`);

  const body = parts.join('\n');
  writeFileSync(resolve(process.cwd(), 'audit/announcements.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>
/* Measured for LAYOUT in an off-screen iframe, where Chrome does not tick
   animations — a running entrance would sit frozen on its first keyframe and
   be measured off-screen. This is what prefers-reduced-motion renders. */
*{animation:none!important;transition:none!important}
body{margin:0;padding:10px;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px}</style>
</head><body><main class="skosx sk-anim" style="padding:24px">${body}</main>${portals.join('')}</body></html>`);

  // Proof the queries settled and the panels are the screens they claim to be
  // — without these the audit would happily measure five spinners.
  expect(body, 'the notice to fifteen classes is folded into one row').toContain('15 classes');
  expect(body, 'the audience names the GRADE, not just the section').toContain('Nursery-B');
  expect(body, 'the long title rendered').toContain('revised date sheet');
  expect(body, 'the empty state rendered').toContain('Nothing posted yet');
  expect(portals.join(''), 'the drawers really opened').toContain('sk-panel');
  expect(portals.join(''), 'the class picker rendered').toContain('sk-annpick');
  expect(portals.join(''), 'a grade was actually chosen').toContain('aria-pressed="true"');
  expect(portals.join(''), 'and it says how many families that is').toMatch(/3 classes · \d+ students/);
  expect(portals.join(''), 'the delete confirmation rendered').toContain('cannot be\n              taken back'.replace(/\s+/g, ' ').slice(0, 10));
  console.log(`wrote audit/announcements.html — ${body.length} bytes, ${portals.length} portals`);
});
