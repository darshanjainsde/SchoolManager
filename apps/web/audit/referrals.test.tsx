// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';
import ReferralsPage from '@/app/platform/referrals/page';

/**
 * The owner console's Referrals tab, rendered for a browser to measure
 * (see README.md and measure.html). Hook-driven like Pay, so it is mounted
 * with resolved query data and serialised once settled. Fixtures carry the
 * longest realistic values: a full Indian name, a school name that wraps, a
 * lakh-scale reward, a phone typed with spaces.
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROMOTERS = [
  { id: 'p1', code: 'RAJESH42', name: 'Rajeshwari Balasubramanian', email: 'rajeshwari.balasubramanian@example.com', phoneE164: '+919876543210', city: 'Thiruvananthapuram', status: 'ACTIVE', statusReason: null, who: 'Tuition owner', expect: '6-10', areas: 'Thiruvananthapuram, Kollam, Alappuzha', know: 'Run a coaching centre; principals of eight schools send students to me every year.', schoolsInMind: 'St. Thomas Higher Secondary School; Holy Angels Convent', hasGst: true, commissionPct: 12, commissionCapMinor: 50_000_00, commissionNote: 'Strong network; reviewed after three live schools.', commissionSetAt: '2026-10-02T00:00:00Z', payeeName: 'Rajeshwari Balasubramanian', panMasked: 'AB•••••4K', bankAccountMasked: '••••6789', ifsc: 'HDFC0001234', upi: null, gstin: '32ABCPM1234K1ZV', payoutDetailsAt: '2026-10-05T00:00:00Z', kycVerifiedAt: '2026-10-06T00:00:00Z', createdAt: '2026-09-28T00:00:00Z', referred: 7, live: 2, earnedMinor: 1_24_950_00, paidMinor: 1_22_451_00, openTasks: [] },
  { id: 'p2', code: 'PRIYA18', name: 'Priya Sharma', email: 'priya@example.com', phoneE164: null, city: 'Kota', status: 'ACTIVE', statusReason: null, who: 'Parent, PTA member', expect: '3-5', areas: 'Kota', know: 'On the PTA of two schools; my brother runs a printing press that serves twenty schools.', schoolsInMind: null, hasGst: false, commissionPct: null, commissionCapMinor: null, commissionNote: null, commissionSetAt: null, payeeName: null, panMasked: null, bankAccountMasked: null, ifsc: null, upi: null, gstin: null, payoutDetailsAt: null, kycVerifiedAt: null, createdAt: '2026-10-20T00:00:00Z', referred: 1, live: 0, earnedMinor: 0, paidMinor: 0, openTasks: ['COMMISSION'] },
  { id: 'p3', code: 'AMIT07', name: 'Amit Verma', email: 'amit@example.com', phoneE164: '+919123456789', city: 'Udaipur', status: 'SUSPENDED', statusReason: 'Two referrals logged without the contact’s consent.', who: 'Ed consultant', expect: '10+', areas: 'Udaipur, Bhilwara, Chittorgarh', know: 'Consult for school boards on affiliation.', schoolsInMind: null, hasGst: true, commissionPct: 15, commissionCapMinor: 0, commissionNote: null, commissionSetAt: '2026-10-05T00:00:00Z', payeeName: 'Amit Verma', panMasked: 'AB•••••1K', bankAccountMasked: null, ifsc: null, upi: 'amit@okaxis', gstin: null, payoutDetailsAt: '2026-10-07T00:00:00Z', kycVerifiedAt: null, createdAt: '2026-09-30T00:00:00Z', referred: 0, live: 0, earnedMinor: 0, paidMinor: 0, openTasks: [] },
];
const ref = (id: string, o: Record<string, unknown>) => ({
  id, schoolName: 'School', city: 'Jaipur', area: null, studentsApprox: null, contactName: 'Mrs Kapoor', contactRole: 'Principal', contactPhone: '98111 22334', contactEmail: null, planInterest: null, howKnown: null, consent: true, viaLink: false,
  status: 'LOGGED', statusReason: null, attributionUntil: '2027-01-21T00:00:00Z', lapsed: false, invoiceMinor: null, rewardMinor: null, createdAt: '2026-10-14T00:00:00Z', leadId: null,
  promoter: { id: 'p1', name: 'Rajeshwari Balasubramanian', code: 'RAJESH42', commissionPct: 12, commissionCapMinor: 50_000_00 }, payout: null, events: [], ...o,
});
const REFERRALS = [
  ref('r1', { schoolName: "St. Mary's Convent Senior Secondary School", city: 'Jaipur', area: 'Malviya Nagar', studentsApprox: 650, contactName: 'Mrs Lakshmi Venkataraman', status: 'PAID', planInterest: 'Standard', invoiceMinor: 12_49_500_00, rewardMinor: 50_000_00, createdAt: '2026-09-02T00:00:00Z', leadId: 'l1', payout: { id: 'y1', status: 'PAID', netMinor: 49_000_00, dueOn: '2026-10-31T00:00:00Z' } }),
  ref('r2', { schoolName: 'Beacon Public School', city: 'Ajmer', area: 'Vaishali Nagar', studentsApprox: 900, contactName: 'Mr Rao', contactRole: 'Owner', status: 'PAYOUT_DUE', planInterest: 'Pro', invoiceMinor: 44_99_100_00, rewardMinor: 50_000_00, createdAt: '2026-09-14T00:00:00Z', leadId: 'l2', payout: { id: 'y2', status: 'DUE', netMinor: 49_000_00, dueOn: '2026-11-18T00:00:00Z' } }),
  ref('r3', { schoolName: 'Sunrise Academy', city: 'Jaipur', area: 'Mansarovar', studentsApprox: 420, contactName: 'Ms Iyer', contactRole: 'Admin', status: 'DEMO_DONE', planInterest: 'Standard', leadId: 'l3' }),
  ref('r4', { schoolName: 'Little Flowers School', city: 'Jaipur', area: 'Tonk Road', status: 'REJECTED', statusReason: 'Already referred by another promoter on 3 Oct 2026.', createdAt: '2026-10-08T00:00:00Z' }),
  ref('r5', { schoolName: 'Green Valley International School and Junior College', city: 'Kota', area: 'Talwandi', studentsApprox: 1100, contactName: 'Mrs Singh', status: 'LOGGED', planInterest: 'Pro', promoter: { id: 'p2', name: 'Priya Sharma', code: 'PRIYA18', commissionPct: null, commissionCapMinor: null }, createdAt: '2026-10-22T00:00:00Z' }),
  ref('r6', { schoolName: 'Lakeview Academy', city: 'Udaipur', area: 'Fatehpura', status: 'WON', consent: false, contactName: 'Mr Mehta', contactRole: 'Owner', planInterest: 'Standard', createdAt: '2026-10-10T00:00:00Z', leadId: 'l6' }),
];
const TASKS = [
  { id: 't1', kind: 'COMMISSION', createdAt: '2026-10-21T00:00:00Z', note: null, promoter: PROMOTERS[1], referral: null, suggestedPct: 10, suggestedCapMinor: 50_000_00, duplicate: null, lapsed: false },
  { id: 't2', kind: 'REFERRAL', createdAt: '2026-10-22T00:00:00Z', note: null, promoter: PROMOTERS[1], referral: REFERRALS[4], suggestedPct: null, suggestedCapMinor: 50_000_00, duplicate: null, lapsed: false },
  { id: 't3', kind: 'REFERRAL', createdAt: '2026-10-22T00:00:00Z', note: null, promoter: PROMOTERS[0], referral: ref('r7', { schoolName: 'St. Marys Convent', city: 'Jaipur', contactName: 'Mr Someone', contactPhone: '+91 98111 22334', status: 'LOGGED' }), suggestedPct: null, suggestedCapMinor: 50_000_00, duplicate: { kind: 'referral', on: '2026-09-02T00:00:00Z' }, lapsed: false },
  { id: 't4', kind: 'KYC', createdAt: '2026-10-19T00:00:00Z', note: 'Payout due; no payout details yet.', promoter: { ...PROMOTERS[0], pan: 'ABCPM1234K', bankAccount: '50100123456789' }, referral: null, suggestedPct: null, suggestedCapMinor: 50_000_00, duplicate: null, lapsed: false },
];
const PAYOUTS = [
  { id: 'y1', grossMinor: 50_000_00, tdsMinor: 1_000_00, netMinor: 49_000_00, dueOn: '2026-10-31T00:00:00Z', status: 'PAID', utr: 'UTR2610310093', paidOn: '2026-10-31T00:00:00Z', referral: { id: 'r1', schoolName: "St. Mary's Convent Senior Secondary School", city: 'Jaipur', invoiceMinor: 12_49_500_00 }, promoter: { ...PROMOTERS[0], detailsComplete: true, kycVerified: true } },
  { id: 'y2', grossMinor: 50_000_00, tdsMinor: 1_000_00, netMinor: 49_000_00, dueOn: '2026-11-18T00:00:00Z', status: 'DUE', utr: null, paidOn: null, referral: { id: 'r2', schoolName: 'Beacon Public School', city: 'Ajmer', invoiceMinor: 44_99_100_00 }, promoter: { ...PROMOTERS[0], detailsComplete: true, kycVerified: true } },
  { id: 'y3', grossMinor: 53_98_920_00, tdsMinor: 1_07_978_00, netMinor: 52_90_942_00, dueOn: '2026-11-22T00:00:00Z', status: 'DUE', utr: null, paidOn: null, referral: { id: 'r8', schoolName: 'Lakeview Academy', city: 'Udaipur', invoiceMinor: 3_59_92_800_00 }, promoter: { ...PROMOTERS[2], detailsComplete: false, kycVerified: false } },
];
const SETTINGS = { ladder: { '1-2': 8, '3-5': 10, '6-10': 12, '10+': 15 }, capMinor: 50_000_00, payoutDays: 30, attributionDays: 90, tdsPct: 2 };

beforeEach(() => {
  useAuthStore.setState({ status: 'authed', audience: 'platform' });
  vi.mocked(useApi).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p === '/owner/referrals/tasks') return TASKS;
      if (p.startsWith('/owner/referrals/payouts')) return PAYOUTS;
      if (p.startsWith('/owner/referrals/promoters')) return PROMOTERS;
      if (p === '/owner/referrals/settings') return SETTINGS;
      if (p.startsWith('/owner/referrals')) return REFERRALS;
      return [];
    }),
    post: vi.fn(async () => ({})), put: vi.fn(async () => ({})), patch: vi.fn(async () => ({})), del: vi.fn(),
  } as never);
});

async function settle(host: HTMLElement) {
  let previous = '';
  for (let i = 0; i < 12 && host.innerHTML !== previous; i += 1) {
    previous = host.innerHTML;
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function markup(after?: (host: HTMLElement) => void | Promise<void>): Promise<{ html: string; portal: string }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={client}><ReferralsPage /></QueryClientProvider>); });
  await settle(host);
  if (after) { await act(async () => { await after(host); }); await settle(host); }
  const portal = [...document.body.children].filter((el) => el !== host && el.querySelector('.sk-panel')).map((el) => el.outerHTML).join('');
  const html = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return { html, portal };
}

const tab = (name: string) => (host: HTMLElement) => { [...host.querySelectorAll<HTMLButtonElement>('.sk-tab')].find((b) => b.textContent?.trim().startsWith(name))?.click(); };
const then = (first: (h: HTMLElement) => void, label: string) => async (host: HTMLElement) => {
  first(host);
  await settle(host);
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)?.click();
};

it('writes the real owner Referrals screens for a browser to measure', async () => {
  const panels: [string, ((h: HTMLElement) => void | Promise<void>)?][] = [
    ['Tasks'],
    ['Promoters', tab('Promoters')],
    ['Promoters — set rate open', then(tab('Promoters'), 'Set rate')],
    ['Promoters — add a promoter', then(tab('Promoters'), '+ Add a promoter')],
    ['Referrals', tab('Referrals')],
    ['Referrals — mark live open', then(tab('Referrals'), '→ Live & paid')],
    ['Payouts', tab('Payouts')],
    ['Payouts — mark paid open', then(tab('Payouts'), 'Mark paid')],
    ['Settings', tab('Settings')],
  ];
  const parts: string[] = [];
  const portals: string[] = [];
  for (const [name, after] of panels) {
    const { html, portal } = await markup(after);
    parts.push(`<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${html}</section>`);
    if (portal) portals.push(`<div class="audit-panel" data-panel="${name}">${portal}</div>`);
  }
  const body = parts.join('\n');
  writeFileSync(resolve(process.cwd(), 'audit/referrals.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>*{animation:none!important;transition:none!important}
body{margin:0;padding:10px;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px}</style>
</head><body><main class="skosx sk-anim" style="padding:24px"><div class="sk-own-main">${body}</div></main>${portals.join('')}</body></html>`);
  console.log(`wrote audit/referrals.html — ${body.length} bytes of real component markup`);
  expect(body).toContain('Rajeshwari Balasubramanian');
  expect(body).toContain('Green Valley International School and Junior College');
  expect(body).toContain('₹52,90,942');
  expect(body).toContain('another promoter holds this school');
  expect(portals.join('')).toContain('Commission for Rajeshwari Balasubramanian');
  expect(portals.join('')).toContain('is live and has paid');
  expect(portals.join('')).toContain('Pay ₹49,000');
  expect(body.length).toBeGreaterThan(5000);
});
