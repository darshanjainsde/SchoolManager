// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupportBoard, SupportTicketDetail, SupportTicketRow } from '@skoolos/types';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useAuthStore } from '@/lib/auth-store';
import HelpPage from '@/app/app/support/page';
import OwnerSupportPage from '@/app/platform/support/page';
import OwnerTicketPage from '@/app/platform/support/[id]/page';

/**
 * The Support desk's four screens, rendered for a browser to measure (see
 * README.md and measure.html): the school's Help list with its thread drawer
 * and the Report drawer, the owner's board and the owner's desk for one
 * ticket. Fixtures carry the longest realistic values — a full Indian name, a
 * school name that wraps, a title that runs past a phone — per the ledger rule
 * about judging a column on short values.
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 't1' }), usePathname: () => '/platform/support/t1', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const H = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * H).toISOString();
const school = { id: 's1', name: 'Delhi Public School, Vasant Kunj (Senior Wing)', slug: 'dpsvk', tier: 'PRO' };

const row = (o: Partial<SupportTicketRow> = {}): SupportTicketRow => ({
  id: 't1', number: 142, ticketNo: 'SK-000142', type: 'BUG', module: 'FEES', severity: 'BLOCKING',
  title: 'Receipt PDF fails for one student in 9-A when the fee category is blank on the admission record',
  status: 'WAITING_ON_SCHOOL', createdAt: ago(31), lastActivityAt: ago(2), lastSchoolActivityAt: ago(31), lastOwnerActivityAt: ago(2),
  resolvedAt: null, closedAt: null, reopenedAt: null, unanswered: false, lookInUntil: ago(-40), entryCount: 4,
  raisedBy: { name: 'Rajeshwari Balasubramanian' }, school: null, ...o,
});
const ROWS: SupportTicketRow[] = [
  row(),
  row({ id: 't2', ticketNo: 'SK-000139', title: 'Timetable shows Friday twice', module: 'TIMETABLE', severity: 'ANNOYING', status: 'IN_PROGRESS', unanswered: true, lastSchoolActivityAt: ago(30), lookInUntil: null }),
  row({ id: 't3', ticketNo: 'SK-000131', title: 'Add a house-wise sports report', module: 'SPORTS', severity: 'SUGGESTION', type: 'IDEA', status: 'ACKNOWLEDGED', unanswered: false, lastActivityAt: ago(140), lookInUntil: null }),
  row({ id: 't4', ticketNo: 'SK-000120', title: 'Payslip PF line wrong for two teachers', module: 'PAY', severity: 'BLOCKING', status: 'CLOSED', closedAt: ago(200), resolvedAt: ago(220), lookInUntil: null }),
];
const detail = (o: Partial<SupportTicketDetail> = {}): SupportTicketDetail => ({
  ...row(), body: 'Pressing Print receipt for Mohammed Ibrahim Khan (9-A, RPS-00412) shows "Something went wrong". Every other student in the section prints fine. It started this morning after the fee plan was edited.',
  attachments: [{ key: 'support/s1/t1/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-receipt_error_screenshot_2026-10-24.png', name: 'receipt_error_screenshot_2026-10-24.png' }, { key: 'support/s1/t1/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-fee_plan.png', name: 'fee_plan.png' }],
  context: { pagePath: '/app/fees/counter', tier: 'PRO', browser: 'Chrome on Windows', appVersion: null },
  entries: [
    { id: 'e0', authorKind: 'SYSTEM', authorName: null, body: 'Rajeshwari Balasubramanian allowed Sckools to open the console to investigate, for 48 hours.', attachments: [], visibleToSchool: true, statusFrom: null, statusTo: null, createdAt: ago(31) },
    { id: 'e1', authorKind: 'OWNER', authorName: 'Darshan Jain', body: 'Looking at it now.', attachments: [], visibleToSchool: true, statusFrom: 'OPEN', statusTo: 'ACKNOWLEDGED', createdAt: ago(30) },
    { id: 'e2', authorKind: 'OWNER', authorName: 'Darshan Jain', body: 'FeeReceipt row has a null studentCategory; the PDF composer assumes it. GH #412.', attachments: [], visibleToSchool: false, statusFrom: null, statusTo: null, createdAt: ago(29) },
    { id: 'e3', authorKind: 'OWNER', authorName: 'Darshan Jain', body: 'Could you set a fee category for this student under Fees › Students and try again?', attachments: [], visibleToSchool: true, statusFrom: 'IN_PROGRESS', statusTo: 'WAITING_ON_SCHOOL', createdAt: ago(2) },
    { id: 'e4', authorKind: 'SCHOOL', authorName: 'Rajeshwari Balasubramanian', body: 'Done — it still fails, screenshot attached.', attachments: [{ key: 'support/s1/t1/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-again.png', name: 'again.png' }], visibleToSchool: true, statusFrom: 'WAITING_ON_SCHOOL', statusTo: 'IN_PROGRESS', createdAt: ago(1) },
  ],
  canReopen: false, canConfirm: false, assignedTo: { id: 'o1', name: 'Darshan Jain' }, externalRef: '#412', sameModuleOpen: 2, school, ...o,
});
const BOARD: SupportBoard = {
  counts: { unanswered: 6, pastDay: 2, inProgress: 9, waitingOnSchool: 3, open: 17 },
  schools: [
    { schoolId: 's1', name: 'Delhi Public School, Vasant Kunj (Senior Wing)', slug: 'dpsvk', tier: 'PRO', open: 5, waitingOnSchool: 1, oldestUnansweredAt: ago(31), oldestUnansweredTitle: 'Receipt PDF fails for one student in 9-A when the fee category is blank on the admission record' },
    { schoolId: 's2', name: "St. Xavier's High School, Mapusa", slug: 'stxaviersmapusa', tier: 'STANDARD', open: 1, waitingOnSchool: 0, oldestUnansweredAt: ago(26), oldestUnansweredTitle: "Can't invite a new teacher" },
    { schoolId: 's3', name: 'Little Flower Convent', slug: 'littleflower', tier: 'BASIC', open: 2, waitingOnSchool: 0, oldestUnansweredAt: ago(0.6), oldestUnansweredTitle: 'Website logo blurry' },
    { schoolId: 's4', name: 'Raffles Public School', slug: 'raffles', tier: 'PRO', open: 3, waitingOnSchool: 2, oldestUnansweredAt: null, oldestUnansweredTitle: null },
  ],
};

beforeEach(() => {
  useAuthStore.setState({ status: 'authed', audience: 'platform' });
  vi.mocked(useHost).mockReturnValue('dpsvk.sckools.com');
  vi.mocked(useApi).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p === '/manage/support/counts') return { open: 3, waitingOnYou: 1, closed: 11 };
      if (p.startsWith('/manage/support/t1')) return detail({ school: null, assignedTo: null, externalRef: null, canConfirm: false });
      if (p.startsWith('/manage/support')) return ROWS.map((r) => ({ ...r, school: null }));
      if (p === '/owner/support/board') return BOARD;
      if (p.startsWith('/owner/support/tickets')) return ROWS.map((r) => ({ ...r, school }));
      if (p.startsWith('/owner/support/t1')) return detail();
      return [];
    }),
    post: vi.fn(async () => ({})), postForm: vi.fn(async () => ({})), put: vi.fn(async () => ({})), patch: vi.fn(async () => ({})), del: vi.fn(),
  } as never);
});

async function settle(host: HTMLElement) {
  let previous = '';
  for (let i = 0; i < 12 && host.innerHTML !== previous; i += 1) {
    previous = host.innerHTML;
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function markup(Page: () => ReactElement, after?: (host: HTMLElement) => void | Promise<void>): Promise<{ html: string; portal: string }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); });
  await settle(host);
  if (after) { await act(async () => { await after(host); }); await settle(host); }
  const portal = [...document.body.children].filter((el) => el !== host && el.querySelector('.sk-panel')).map((el) => el.outerHTML).join('');
  const html = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return { html, portal };
}

const click = (sel: string) => (host: HTMLElement) => { host.querySelector<HTMLElement>(sel)?.click(); };
const clickText = (label: string) => (host: HTMLElement) => { [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(label))?.click(); };

it('writes the real Support desk screens for a browser to measure', async () => {
  const panels: [string, () => ReactElement, ((h: HTMLElement) => void | Promise<void>)?][] = [
    ['Help — list', HelpPage],
    ['Help — ticket open', HelpPage, click('[data-testid="ticket-t1"]')],
    ['Help — report drawer', HelpPage, clickText('Report a problem')],
    ['Owner — board and list', OwnerSupportPage],
    ['Owner — desk', OwnerTicketPage],
  ];
  const parts: string[] = [];
  const portals: string[] = [];
  for (const [name, Page, after] of panels) {
    const { html, portal } = await markup(Page, after);
    parts.push(`<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${html}</section>`);
    if (portal) portals.push(`<div class="audit-panel" data-panel="${name}">${portal}</div>`);
  }
  const body = parts.join('\n');
  writeFileSync(resolve(process.cwd(), 'audit/support.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>*{animation:none!important;transition:none!important}
body{margin:0;padding:10px;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px}</style>
</head><body><main class="skosx sk-anim" style="padding:24px"><div class="sk-own-main">${body}</div></main>${portals.join('')}</body></html>`);
  console.log(`wrote audit/support.html — ${body.length} bytes of real component markup`);
  expect(body).toContain('SK-000142');
  expect(body).toContain('Rajeshwari Balasubramanian');
  expect(body).toContain('Delhi Public School, Vasant Kunj (Senior Wing)');
  expect(body).toContain('Waiting on you');
  expect(body).toContain('Open as this school');
  expect(portals.join('')).toContain('only the desk sees this');
  expect(portals.join('')).toContain('Report a problem');
  expect(portals.join('')).toContain('We will attach this for you');
  expect(body.length).toBeGreaterThan(5000);
});
