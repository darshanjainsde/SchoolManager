// @vitest-environment jsdom
//
// Renders the REAL Pay screens — hooks, queries and all — and writes what the
// browser will actually receive to audit/pay.html for measurement.
//
// The sports renderer next door can use renderToStaticMarkup because those
// components take props. The Pay tabs are hook-driven, so a static render
// would only ever capture their loading state and the audit would measure
// markup nobody sees. This mounts them with resolved data and serialises the
// settled DOM instead.
//
// Every fixture uses the LONGEST realistic value, per the ui-mistake-ledger
// rule: full Indian names, lakh-scale rupee figures, a grade description that
// runs the width of its card.
import { it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import MonthTab from '@/app/app/pay/month-tab';
import PeopleTab from '@/app/app/pay/people-tab';
import GradesTab from '@/app/app/pay/grades-tab';
import SettingsTab from '@/app/app/pay/settings-tab';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app/pay', useRouter: () => ({ replace: vi.fn() }) }));

const NAMES = [
  'Saanvi Krishnamurthy', 'Rajeshwari Balasubramanian', 'Mohammed Irfan Qureshi',
  'Lakshmi Venkataraman', 'Aadhya Venkataraghavan', 'Priya Nair',
];

const SETTINGS = {
  countryCode: 'IN', currency: 'INR', region: 'RJ', taxYearStartMonth: 4,
  pack: {
    label: 'India', version: 'IN-2026.09.22', rulesAsAt: '2026-09-22', regionLabel: 'State',
    regions: [{ code: 'RJ', name: 'Rajasthan' }],
    regimes: [{ key: 'NEW', label: 'New regime (default)', allows: { hra: false, s80c: false, s80d: false, homeLoanInterest: false } }],
    defaultRegime: 'NEW', payDueDay: 7, fnfWorkingDays: 2, unverified: [],
  },
  countries: ['IN'],
};

const grade = (id: string, name: string, description: string, min: number, max: number, n: number) => ({
  id, name, description, bandMinMinor: min, bandMaxMinor: max, overrides: {},
  order: 10, active: true, note: null,
  headcount: n, monthlyMinor: Math.round(((min + max) / 2) * n),
  split: [
    { key: 'basic', name: 'Basic', amountMinor: Math.round((min + max) / 4) },
    { key: 'hra', name: 'House rent allowance', amountMinor: Math.round((min + max) / 10) },
    { key: 'conveyance', name: 'Conveyance', amountMinor: 160_000 },
    { key: 'special', name: 'Special allowance', amountMinor: Math.round((min + max) / 8) },
  ],
  wageShareNote: null, overshootMinor: 0,
});

const GRADES = [
  grade('g1', 'PGT', 'Post Graduate Teacher', 3_800_000, 6_200_000, 7),
  grade('g2', 'TGT', 'Trained Graduate Teacher', 3_000_000, 4_600_000, 16),
  grade('g3', 'Driver', 'Under the ESI ceiling of twenty-one thousand', 1_500_000, 2_100_000, 6),
];

const PEOPLE = [
  ...NAMES.slice(0, 3).map((name, i) => ({
    personKind: i === 2 ? 'STAFF' : 'TEACHER', id: `p${i}`, name,
    designation: i === 2 ? 'Driver' : 'Teacher', userId: null, pay: null,
  })),
  ...NAMES.map((name, i) => ({
    personKind: 'TEACHER', id: `q${i}`, name, designation: 'Teacher', userId: `u${i}`,
    pay: {
      id: `e${i}`, effectiveFrom: '2026-04-01', monthlyGrossMinor: 3_800_000 + i * 120_000,
      payGradeId: 'g2', taxRegime: 'NEW', pfOptIn: true, paidThroughVacation: true,
      contractMonths: 12, hasBank: i !== 2,
    },
  })),
];

/** A big school, so every figure on screen is a lakh-scale one. */
const OVERVIEW = {
  setup: { countryCode: 'IN', gradeCount: 3, rosterSize: 48, onPay: 45, notOnPay: 3, ready: true },
  period: { year: 2026, month: 9 },
  run: null,
  cost: {
    estimated: true, headcount: 450, grossMinor: 2_257_76_00_00, deductionMinor: 21_45_300_00,
    netMinor: 2_236_30_70_00, employerCostMinor: 89_64_00_00, totalCostMinor: 2_347_40_00_00,
  },
  previousTotalMinor: 1_288_90_000,
  exceptions: [
    { kind: 'NO_PAY', count: 3, label: '3 people have no pay set', names: NAMES.slice(0, 3), goTo: 'people' },
    { kind: 'NO_BANK', count: 1, label: 'Mohammed Irfan Qureshi has no bank account', names: ['Mohammed Irfan Qureshi'], goTo: 'people' },
    { kind: 'ARREARS', count: 2, label: '2 people have arrears this month', names: NAMES.slice(3, 5), goTo: 'people' },
  ],
  recent: [
    { id: 'r1', periodYear: 2026, periodMonth: 8, status: 'PAID', headcount: 47, grossMinor: 1_261_30_000, employerCostMinor: 8_40_000, netMinor: 1_250_00_000 },
    { id: 'r2', periodYear: 2026, periodMonth: 7, status: 'PAID', headcount: 47, grossMinor: 1_258_00_000, employerCostMinor: 8_38_000, netMinor: 1_247_00_000 },
  ],
};

/** Longest realistic case: a full name, a sentence of arithmetic, a half day. */
const LEAVE = {
  basis: 'WORKING_DAY' as const, countHalfDays: true, daysInMonth: 30, workingDays: 26,
  proposals: [
    {
      personKind: 'TEACHER' as const, personId: 't1', name: 'Rajeshwari Balasubramanian',
      lopDays: 2.5, lopWholeDays: 2, lopHalfDays: 1,
      reasons: ['Casual leave 14½ of 12 used → 2½ days over'],
      anchorApplicationId: 'l1', applied: false, clamped: false,
    },
    {
      personKind: 'STAFF' as const, personId: 's1', name: 'Mohammed Irfan Qureshi',
      lopDays: 30, lopWholeDays: 30, lopHalfDays: 0,
      reasons: ['Unpaid leave, 30 days — always deducts'],
      anchorApplicationId: 'l2', applied: false, clamped: true,
    },
  ],
  warnings: ['Lakshmi Venkataraman has leave still waiting on a decision — it is left out of this month.'],
  locked: false,
};

const LEAVE_TYPES = [
  { id: 'sick', name: 'Sick leave', builtin: 'SICK', isPaid: true, defaultAnnual: 12, defaultAnnualStaff: 8, neverDeduct: false, carryForwardCap: 0, isActive: true },
  { id: 'casual', name: 'Casual leave', builtin: 'CASUAL', isPaid: true, defaultAnnual: 12, defaultAnnualStaff: 8, neverDeduct: false, carryForwardCap: 6, isActive: true },
  { id: 'mat', name: 'Maternity leave', builtin: null, isPaid: true, defaultAnnual: 182, defaultAnnualStaff: 182, neverDeduct: true, carryForwardCap: 0, isActive: true },
];

const COMPONENTS = [
  { id: 'c1', key: 'basic', name: 'Basic', kind: 'EARNING', calc: 'PCT_OF_GROSS', rateBps: 5000, taxable: true, isWages: true, retirementBase: true, healthBase: true, gratuityBase: true, prorate: true, order: 10, active: true, hint: 'Half of gross, which is what the Code on Wages asks for' },
  { id: 'c2', key: 'hra', name: 'House rent allowance', kind: 'EARNING', calc: 'PCT_OF_BASIC', rateBps: 4000, taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 20, active: true, hint: null },
  { id: 'c3', key: 'special', name: 'Special allowance', kind: 'EARNING', calc: 'BALANCE', rateBps: null, taxable: true, isWages: true, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 90, active: true, hint: null },
];

const ACCESS = [
  { id: 'u1', name: 'Rajeshwari Balasubramanian', email: 'principal@raffles.sckools.com', canSeeSalary: true, createdAt: '2026-01-01', job: 'Admin' },
  { id: 'u2', name: 'Mohammed Irfan Qureshi', email: 'accounts.officer@raffles.sckools.com', canSeeSalary: false, createdAt: '2026-02-01', job: 'Accounts officer' },
];

function api(get: (p: string) => unknown) {
  return {
    get: vi.fn(async (p: string) => get(p)),
    post: vi.fn(async () => ({ lines: [], wageShare: null, overshootMinor: 0 })),
    put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
  vi.mocked(useApi).mockReturnValue(api((p) => {
    if (p === '/payroll/settings') return SETTINGS;
    if (p === '/payroll/overview') return OVERVIEW;
    if (p === '/payroll/people') return PEOPLE;
    if (p === '/payroll/grades') return GRADES;
    if (p.startsWith('/payroll/leave')) return LEAVE;
    if (p === '/payroll/components') return COMPONENTS;
    if (p === '/payroll/access') return ACCESS;
    if (p.startsWith('/manage/leave-policy/types')) return LEAVE_TYPES;
    return [];
  }) as never);
});

/**
 * Mounts a tab, lets its queries settle, and returns the settled markup.
 *
 * `after` runs once the data has arrived — the drawer lives behind state, so
 * without a click it is never in the markup and never measured. It shipped
 * with its save button below the fold precisely because nothing looked at it.
 */
async function markup(node: React.ReactNode, after?: (host: HTMLElement) => void): Promise<string> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(host);
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  // A second flush: the first resolves the queries, the second renders them.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  if (after) {
    await act(async () => { after(host); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  // The drawer portals to <body>, so it is NOT inside the host — which is the
  // whole point of it. It is written OUTSIDE <main> below, exactly where the
  // console puts it, so the measurement sees the tree a user gets: a portal
  // root that must carry its own `.skosx`, or every token resolves to nothing.
  const portal = [...document.body.children]
    .filter((el) => el !== host && el.querySelector('.sk-panel'))
    .map((el) => el.outerHTML).join('');
  const html = host.innerHTML + (portal ? `</div></main>${portal}<main hidden><div>` : '');
  await act(async () => { root.unmount(); });
  host.remove();
  return html;
}

it('writes the real Pay screens for a browser to measure', async () => {
  /** Opens the first "Set pay" on the People tab, so the drawer is measured too. */
  const openDrawer = (host: HTMLElement) => {
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Set pay');
    btn?.click();
  };
  /** Opens the component editor, so its drawer is measured rather than assumed. */
  const openComponent = (host: HTMLElement) => {
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Change');
    btn?.click();
  };

  const panels: [string, React.ReactNode, ((h: HTMLElement) => void)?][] = [
    ['This month', <MonthTab key="m" base="/app/pay" />],
    ['People', <PeopleTab key="p" base="/app/pay" />],
    ['Grades', <GradesTab key="g" base="/app/pay" />],
    ['People — pay drawer open', <PeopleTab key="d" base="/app/pay" />, openDrawer],
    ['Settings', <SettingsTab key="s" />],
    ['Settings — change a part of a salary', <SettingsTab key="sd" />, openComponent],
  ];

  const parts: string[] = [];
  for (const [name, node, after] of panels) {
    const html = await markup(node, after);
    parts.push(`<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${html}</section>`);
  }
  const body = parts.join('\n');

  const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');
  writeFileSync(resolve(process.cwd(), 'audit/pay.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<style>
/* This file is measured for LAYOUT, in an off-screen iframe. Chrome does not
   tick animations there, so a running entrance sits frozen on its FIRST
   keyframe — a drawer measured entirely outside the viewport, a frame no user
   ever sees. Baked in here rather than injected at measure time, because an
   injection races the frame it is trying to correct. This is exactly what
   prefers-reduced-motion renders. */
*{animation:none!important;transition:none!important}
body{margin:0;padding:10px;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px}</style>
</head><body><main class="skosx sk-anim" style="padding:24px"><div class="sk-paystack">${body}</div></main></body></html>`);

  console.log(`wrote audit/pay.html — ${body.length} bytes of real component markup`);
  // Proof the queries actually settled: a loading render would contain none of
  // these. Without this the audit would happily measure three spinners.
  expect(body).toContain('Saanvi Krishnamurthy');
  expect(body).toContain('Trained Graduate Teacher');
  expect(body).toContain('₹2,34,74,000');
  // The drawer really opened — otherwise the panel measures an empty div and
  // reports CLEAN for a screen nobody rendered.
  expect(body).toContain('sk-panel-actions');
  // The portal root must carry the theme itself: `.skosx` is where every
  // token lives, and a portal on bare <body> shipped see-through once.
  expect(body).toMatch(/<div class="skosx sk-scrim"/);
  expect(body.length).toBeGreaterThan(5000);
});
