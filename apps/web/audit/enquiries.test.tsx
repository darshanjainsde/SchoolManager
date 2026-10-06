// @vitest-environment jsdom
// apps/web/audit/enquiries.test.tsx
/* eslint-disable react/jsx-key -- panels are mounted one at a time, never as siblings */
import { it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import EnquiriesPage from '@/app/app/enquiries/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));

const NAMES = ['Rajeshwari Balasubramanian', 'Mohammed Irfan Qureshi', 'Aadhya Venkataraghavan', 'Priya Nair'];
const STAGES = ['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'LOST'];
const SOURCES = ['WEBSITE', 'COURSE_CARD', 'WALK_IN', 'PHONE'];

const LEADS = Array.from({ length: 12 }, (_, i) => ({
  id: `L${i}`,
  parentName: NAMES[i % 4],
  childName: i % 2 ? 'Saanvi Krishnamurthy' : null,
  phone: '+91 98290 11223',
  email: i % 3 ? null : 'rajeshwari.balasubramanian@example.com',
  gradeInterest: 'Class XI — Science (PCM with Computer Science)',
  message: 'We are moving from Bengaluru in April and want to know about transport from Malviya Nagar and the hostel.',
  status: STAGES[i % 5],
  source: SOURCES[i % 4],
  whatsappOk: i % 2 === 0,
  followUpAt: i % 4 ? '2026-10-03' : null,
  lastContactedAt: i % 3 ? '2026-10-02T06:30:00.000Z' : null,
  ownerUserId: i % 2 ? 'u-off' : null,
  ownerName: i % 2 ? 'Sunita Kale' : null,
  ownerOnDesk: i % 2 === 1,
  lostReason: i % 5 === 4 ? 'Chose a school nearer home — the bus would take an hour each way' : null,
  noteCount: 2,
  createdAt: `2026-09-${String(10 + i).padStart(2, '0')}T05:00:00.000Z`,
  updatedAt: '2026-10-02T06:30:00.000Z',
}));

const NOTES = [
  { id: 'n1', kind: 'CALL', body: 'Called — interested', authorName: 'Sunita Kale', createdAt: '2026-10-02T06:30:00.000Z' },
  { id: 'n2', kind: 'STAGE', body: 'Moved to Interested', authorName: 'Sunita Kale', createdAt: '2026-10-02T06:30:01.000Z' },
  { id: 'n3', kind: 'SYSTEM', body: 'Enquiry received from the website — asked about Class XI', authorName: null, createdAt: '2026-09-10T05:00:00.000Z' },
];

beforeEach(() => {
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p === '/auth/me') return { userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' };
      if (p === '/site/enquiries') return LEADS;
      if (p === '/site/enquiries/owners') {
        return [
          { userId: 'u-off', name: 'Sunita Kale', job: 'ADMISSIONS' },
          { userId: 'u-adm', name: 'Principal Rajeshwari Balasubramanian', job: 'ADMIN' },
        ];
      }
      return { ...LEADS[1], notes: NOTES };
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as never);
});

type Step = (host: HTMLElement) => void;

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

const press = (label: string): Step => (host) => {
  [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)?.click();
};
const call: Step = (host) => {
  [...host.querySelectorAll('a')].find((a) => (a.textContent ?? '').startsWith('Call '))?.click();
};

it('writes the real admissions desk for a browser to measure', async () => {
  const panels: [string, Step[]][] = [
    ['Enquiries — my leads', []],
    ['Enquiries — unowned', [(host) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Unowned'))?.click()]],
    ['Enquiries — after a call', [call]],
    ['Enquiries — after a call, not going ahead', [call, press('Lost')]],
    ['Enquiries — add an enquiry', [press('Add enquiry')]],
  ];
  const parts: string[] = [];
  const portals: string[] = [];
  for (const [name, steps] of panels) {
    const { html, portal } = await run(<EnquiriesPage />, steps);
    expect(html.length, name).toBeGreaterThan(500);
    parts.push(`<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${html}</section>`);
    if (portal) portals.push(`<div class="audit-panel" data-panel="${name}">${portal}</div>`);
  }
  const body = parts.join('\n');
  writeFileSync(resolve(process.cwd(), 'audit/enquiries.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>
*{animation:none!important;transition:none!important}
body{margin:0;padding:10px;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px}</style>
</head><body><main class="skosx sk-anim" style="padding:24px">${body}</main>${portals.join('')}</body></html>`);

  expect(body, 'the long name rendered').toContain('Mohammed Irfan Qureshi');
  expect(body, 'the source chip rendered').toContain('sk-enq-src');
  expect(body, 'the outcome sheet opened').toContain('How did the call go?');
  expect(body, 'Lost asked why').toContain('Why the family is not going ahead');
  expect(portals.join(''), 'the add drawer opened').toContain('sk-panel');
  console.log(`wrote audit/enquiries.html — ${body.length} bytes, ${portals.length} portals`);
});
