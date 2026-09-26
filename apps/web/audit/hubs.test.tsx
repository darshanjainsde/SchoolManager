// @vitest-environment jsdom
/* eslint-disable react/jsx-key -- the panels are mounted one at a time, never rendered as siblings */
//
// Renders the REAL hub screens — Fees, Reports & Documents, Print Store,
// Onboarding, and the Pay home in both its lives — with resolved data, and
// writes the settled DOM to audit/hubs.html for the browser to measure at
// 360 / 390 / 414 / 768 / 1024 / 1280 / 1440 / 1920.
//
// Every fixture uses the LONGEST realistic value, per the ui-mistake-ledger
// rule: full Indian names, crore-scale rupee figures, a long file name, a
// long order title.
import { it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import FeesHomePage from '@/app/app/fees/page';
import ReportsDocumentsPage from '@/app/app/press/page';
import PressOrdersPage from '@/app/app/press/orders/page';
import OnboardingPage from '@/app/app/onboarding/page';
import HomeTab from '@/app/app/pay/home-tab';
import { PayShell } from '@/app/app/pay/shell';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => true }));
const params = new URLSearchParams();
vi.mock('next/navigation', () => ({ usePathname: () => '/app/pay', useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => params }));

const NAMES = ['Saanvi Krishnamurthy', 'Rajeshwari Balasubramanian', 'Mohammed Irfan Qureshi', 'Lakshmi Venkataraman', 'Aadhya Venkataraghavan', 'Priya Nair', 'Kabir Singh Shekhawat', 'Aarav Mehta'];

const FEE_SUMMARY = {
  todayByMethod: [{ method: 'UPI', amountMinor: 1_18_500_00, count: 4 }, { method: 'CASH', amountMinor: 42_000_00, count: 3 }, { method: 'CHEQUE', amountMinor: 2_20_000_00, count: 2 }],
  todayTotalMinor: 3_80_500_00,
  awaitingReviewMinor: 12_51_300_00, awaitingReviewCount: 23,
  billedMinor: 3_18_33_950_00, collectedMinor: 1_24_12_600_00, outstandingMinor: 1_94_21_350_00,
};
const FEE_RECENT = NAMES.map((name, i) => ({
  id: `p${i}`, status: (['SUBMITTED', 'VERIFIED', 'VERIFIED', 'REJECTED', 'SUBMITTED', 'VERIFIED', 'REVERSED', 'VERIFIED'] as const)[i],
  method: (['UPI', 'CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI', 'ONLINE', 'CASH', 'UPI'] as const)[i],
  amountMinor: 18_500_00 + i * 12_345_00, paidOn: '2026-09-26', submittedAt: `2026-09-${26 - i}T08:00:00.000Z`,
  receiptNumber: i % 2 ? `RCP/2026-27/00${120 + i}` : null,
  student: { id: `s${i}`, name, className: ['Nursery A', '12 Commerce B', '7 B', '3 A', 'LKG Morning', '10 A', '11 Science A', '5 C'][i] },
}));

const PRESS_OVERVIEW = {
  windows: [{ id: 'w1', name: 'Term I', academicYearId: 'y1', academicYearName: '2026-27', startDate: '2026-06-01', endDate: '2026-09-30', resultDay: null }],
  windowId: 'w1',
  classes: [{ id: 'c1', label: 'III-A', students: 427, issued: 427 }, { id: 'c2', label: 'VII-B', students: 822, issued: 415 }, { id: 'c3', label: 'X-A', students: 552, issued: 0 }],
  register: { total: 12_684, lastSerial: 'REP/2026-27/12684' },
  certificates: { lastSerial: 'TC/2026-27/0041', thisYear: 39 },
  orders: { awaitingConfirm: 2, quotedTotalMinor: 1_18_000_00, open: 5 },
};
const REGISTER = { items: NAMES.map((name, i) => ({
  id: `r${i}`, type: (['TC', 'REPORT_CARD', 'BONAFIDE', 'CHARACTER', 'REPORT_CARD', 'TC', 'REPORT_CARD', 'BONAFIDE'] as const)[i],
  serial: ['TC/2026-27/0041', 'REP/2026-27/12684', 'BON/2026-27/0212', 'CHR/2026-27/0007', 'REP/2026-27/12683', 'TC/2026-27/0040', 'REP/2026-27/12682', 'BON/2026-27/0211'][i],
  studentId: `s${i}`, studentName: name, issuedAt: `2026-09-${26 - i}T05:00:00.000Z`, voidedAt: i === 3 ? '2026-09-24T05:00:00.000Z' : null,
})), nextCursor: null };

const spec = (gsm = 80) => ({ size: 'A4', colour: 'COLOUR', sides: 'DOUBLE', gsm, finish: 'STAPLE' } as const);
const ORDERS = [
  { id: 'o1', kind: 'UPLOAD', title: 'Term I question papers · Classes VI to XII · all subjects · sealed sets', quantity: 12_400, spec: spec(), status: 'PRINTING', neededBy: null, quote: { priceMinor: 1_86_000_00, promisedBy: '2026-10-03T00:00:00.000Z', note: null, quotedAt: '2026-09-20T00:00:00.000Z' }, createdAt: '2026-09-18T00:00:00.000Z' },
  { id: 'o2', kind: 'REPORT_CARDS', title: 'Report cards · Term I · Classes III–V', quantity: 1_240, spec: spec(130), status: 'QUOTED', neededBy: null, quote: { priceMinor: 49_600_00, promisedBy: '2026-10-08T00:00:00.000Z', note: null, quotedAt: '2026-09-25T00:00:00.000Z' }, createdAt: '2026-09-24T00:00:00.000Z' },
  { id: 'o3', kind: 'REPORT_CARDS', title: 'Report cards · Term I · Classes VI–VIII', quantity: 1_180, spec: spec(130), status: 'QUOTED', neededBy: null, quote: { priceMinor: 47_200_00, promisedBy: '2026-10-08T00:00:00.000Z', note: null, quotedAt: '2026-09-25T00:00:00.000Z' }, createdAt: '2026-09-24T00:00:00.000Z' },
  { id: 'o4', kind: 'UPLOAD', title: 'Admission forms 2027–28', quantity: 5_000, spec: spec(), status: 'DISPATCHED', neededBy: null, quote: { priceMinor: 40_000_00, promisedBy: '2026-09-28T00:00:00.000Z', note: null, quotedAt: '2026-09-15T00:00:00.000Z' }, createdAt: '2026-09-12T00:00:00.000Z' },
  { id: 'o5', kind: 'UPLOAD', title: 'Annual day invitation cards', quantity: 2_000, spec: spec(300), status: 'REQUESTED', neededBy: null, quote: null, createdAt: '2026-09-26T00:00:00.000Z' },
  { id: 'o6', kind: 'UPLOAD', title: 'Circular · fee schedule 2026–27', quantity: 1_800, spec: spec(), status: 'DELIVERED', neededBy: null, quote: { priceMinor: 9_000_00, promisedBy: '2026-08-20T00:00:00.000Z', note: null, quotedAt: '2026-08-12T00:00:00.000Z' }, createdAt: '2026-08-10T00:00:00.000Z' },
];

const SESSIONS = { years: [{ id: 'y1', name: '2026-27', isCurrent: true }, { id: 'y0', name: '2025-26', isCurrent: false }] };
const ONBOARDING_STATUS = {
  year: { id: 'y1', name: '2026-27' },
  grades: 17, sections: 64, teachers: 143, students: 2_412,
  imports: [
    { id: 'i3', kind: 'students', fileName: 'Raffles-International-School-students-2026-27-final-corrected-v3.xlsx', rows: 2_414, created: 2_412, skipped: 0, failed: 2, createdAt: '2026-09-24T09:00:00.000Z' },
    { id: 'i2', kind: 'teachers', fileName: 'teachers.xlsx', rows: 143, created: 143, skipped: 0, failed: 0, createdAt: '2026-09-18T09:00:00.000Z' },
    { id: 'i1', kind: 'classes', fileName: 'classes-and-sections.xlsx', rows: 64, created: 60, skipped: 4, failed: 0, createdAt: '2026-09-17T09:00:00.000Z' },
  ],
};

const SETTINGS = {
  countryCode: 'IN', currency: 'INR', region: 'RJ', taxYearStartMonth: 4,
  pack: { label: 'India', version: 'IN-2026.09.22', rulesAsAt: '2026-09-22', regionLabel: 'State', regions: [{ code: 'RJ', name: 'Rajasthan' }], regimes: [], defaultRegime: 'NEW', payDueDay: 7, fnfWorkingDays: 2, unverified: [] },
  countries: ['IN'],
};
const PAY_READY = {
  setup: { countryCode: 'IN', gradeCount: 8, rosterSize: 450, onPay: 447, notOnPay: 3, ready: true },
  period: { year: 2026, month: 10 },
  run: { id: 'run1', status: 'CALCULATED', headcount: 447, grossMinor: 2_257_76_00_00, deductionMinor: 21_45_300_00, netMinor: 2_236_30_70_00, employerCostMinor: 89_64_00_00 },
  cost: { estimated: false, headcount: 447, grossMinor: 2_257_76_00_00, deductionMinor: 21_45_300_00, netMinor: 2_236_30_70_00, employerCostMinor: 89_64_00_00, totalCostMinor: 2_347_40_00_00 },
  previousTotalMinor: 2_288_90_000_00,
  exceptions: [
    { kind: 'NO_PAY', count: 3, label: '3 people have no pay set', names: NAMES.slice(0, 3), goTo: 'people' },
    { kind: 'NO_BANK', count: 11, label: '11 people have no bank account', names: NAMES.slice(3, 6), goTo: 'people' },
  ],
  recent: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, periodYear: 2026, periodMonth: 10 - i, status: i === 0 ? 'CALCULATED' : 'PAID', headcount: 447 - i, grossMinor: 2_257_76_00_00 - i * 1_00_000_00, employerCostMinor: 89_64_00_00, netMinor: 2_236_30_70_00 })),
};
const PAY_FRESH = { ...PAY_READY, setup: { countryCode: 'IN', gradeCount: 0, rosterSize: 450, onPay: 0, notOnPay: 450, ready: false }, run: null, exceptions: [], recent: [], previousTotalMinor: null };

let overview: unknown = PAY_READY;
beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
  vi.mocked(useApi).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p.startsWith('/manage/fees/summary')) return FEE_SUMMARY;
      if (p.startsWith('/manage/fees/payments/recent')) return FEE_RECENT;
      if (p.startsWith('/manage/press/overview')) return PRESS_OVERVIEW;
      if (p === '/manage/press/register') return REGISTER;
      if (p === '/manage/press/orders') return ORDERS;
      if (p === '/manage/sessions') return SESSIONS;
      if (p === '/manage/onboarding/status') return ONBOARDING_STATUS;
      if (p === '/payroll/settings') return SETTINGS;
      if (p === '/payroll/overview') return overview;
      return [];
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
    download: vi.fn(), postForm: vi.fn(),
  } as never);
});

/** Mounts a screen, lets its queries settle, returns the settled markup. */
async function markup(node: React.ReactNode, after?: (host: HTMLElement) => void): Promise<string> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  let previous = '';
  for (let i = 0; i < 10 && host.innerHTML !== previous; i += 1) {
    previous = host.innerHTML;
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  if (after) {
    await act(async () => { after(host); });
    let prev = '';
    for (let i = 0; i < 10 && host.innerHTML !== prev; i += 1) {
      prev = host.innerHTML;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
  }
  const html = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return html;
}

it('writes the real hub screens for a browser to measure', async () => {
  const panels: [string, React.ReactNode, ((h: HTMLElement) => void)?][] = [
    ['Fees', <FeesHomePage />],
    ['Reports & Documents', <ReportsDocumentsPage />],
    ['Print Store', <PressOrdersPage />],
    ['Onboarding', <OnboardingPage />],
    ['Pay home · month', <PayShell base="/app/pay" subtitle="What the school pays, and what it files."><HomeTab base="/app/pay" /></PayShell>],
    ['Pay home · guide open', <PayShell base="/app/pay" subtitle="What the school pays, and what it files."><HomeTab base="/app/pay" /></PayShell>,
      (h) => [...h.querySelectorAll('button')].find((b) => /How Pay works/.test(b.textContent ?? ''))?.click()],
  ];
  const parts: string[] = [];
  for (const [name, node, after] of panels) {
    const html = await markup(node, after);
    expect(html.length, name).toBeGreaterThan(500);
    expect(html, `${name} has no boxed wrapper`).not.toMatch(/max-w-\dxl/);
    parts.push(`<section class="panel" data-panel="${name}"><h2 class="panel-h">${name}</h2><main class="skosx sk-anim min-w-0 flex-1 overflow-auto overflow-x-hidden p-6 sm:p-10" style="background:var(--sk-paper)">${html}</main></section>`);
  }
  overview = PAY_FRESH;
  const fresh = await markup(<PayShell base="/app/pay" subtitle="What the school pays, and what it files."><HomeTab base="/app/pay" /></PayShell>);
  parts.push(`<section class="panel" data-panel="Pay home · before the first run"><h2 class="panel-h">Pay home · before the first run</h2><main class="skosx sk-anim min-w-0 flex-1 overflow-auto overflow-x-hidden p-6 sm:p-10" style="background:var(--sk-paper)">${fresh}</main></section>`);

  writeFileSync(resolve(process.cwd(), 'audit/hubs.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0}.panel{margin:0 0 40px;border-bottom:12px solid #000}.panel-h{position:sticky;top:0;z-index:99;margin:0;padding:6px 16px;background:#111;color:#fff;font:700 12px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
main.skosx{display:block}</style>
</head><body>${parts.join('\n')}</body></html>`);
  console.log(`wrote audit/hubs.html — ${parts.length} panels`);
});
