// @vitest-environment jsdom
/* eslint-disable react/jsx-key -- the panels are mounted one at a time, never rendered as siblings */
//
// Renders the REAL Settings tabs (settings audit, 11 Oct 2026) — School year,
// Notifications (overview, email, WhatsApp & phone) and General — with
// resolved data, and writes the settled DOM to audit/settings.html for the
// browser to measure at 360 … 1920. Fixtures use the longest realistic values.
import { it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { SettingsTabs } from '@/app/app/settings/tabs';
import SchoolYearPage from '@/app/app/settings/page';
import NotificationsPage from '@/app/app/settings/notifications/page';
import GeneralPage from '@/app/app/settings/general/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
let pathname = '/app/settings';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SCHOOL = 'Shri Rajeshwari Balasubramanian Memorial Senior Secondary School';
const YEARS = [
  { id: 'y2', name: '2026-27 (CBSE session, April to March)', startDate: '2026-04-01', endDate: '2027-03-31', isCurrent: true },
  { id: 'y1', name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31' },
];
const PERIODS = [
  ['Assembly and morning prayer', '07:40', '08:00', 'BREAK'], ['Period I', '08:00', '08:45', 'CLASS'], ['Period II', '08:45', '09:30', 'CLASS'],
  ['Period III', '09:30', '10:15', 'CLASS'], ['Short break', '10:15', '10:35', 'BREAK'], ['Period IV', '10:35', '11:20', 'CLASS'],
  ['Period V', '11:20', '12:05', 'CLASS'], ['Lunch', '12:05', '12:35', 'BREAK'], ['Period VI', '12:35', '13:20', 'CLASS'], ['Period VII', '13:20', '14:05', 'CLASS'],
].map(([label, startTime, endTime, kind], i) => ({ id: `p${i}`, label, order: i + 1, startTime, endTime, kind }));
const EMAIL = {
  settings: { template: 'BANNER', senderName: SCHOOL, replyTo: 'principal.office.administration@rajeshwarimemorialschool.edu.in', accentColor: '#4F46E5', logoAssetId: null, footerLines: ['14 Lake Road, Indiranagar, Bengaluru 560038'] },
  effective: { schoolName: SCHOOL, senderName: SCHOOL, fromAddress: 'notify@notify.sckools.com', replyTo: 'principal.office.administration@rajeshwarimemorialschool.edu.in', accent: '#4F46E5', logoUrl: null, template: 'BANNER', footerLines: [], usingCustomSender: false, showPlatformCredit: true },
  sender: { mode: 'CUSTOM', status: 'FAILING', fromAddress: 'office@rajeshwarimemorialschool.edu.in', smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpUser: 'office@rajeshwarimemorialschool.edu.in', hasPassword: true, verifiedAt: null, lastError: '535-5.7.8 Username and Password not accepted. Learn more at https://support.google.com/mail/?p=BadCredentials', lastErrorAt: null, canConfigure: true },
  previews: [{ template: 'BANNER', html: '<p>Preview</p>' }],
  deliveries: { thisMonth: { DELIVERED: 18_412, SENT: 1_204, BOUNCED: 37, FAILED: 4 }, recent: [], suppressed: [{ email: 'saanvi.krishnamurthy.parent@gmial.com', reason: 'BOUNCE', detail: 'mailbox does not exist', createdAt: '2026-10-01T00:00:00Z' }] },
};
/** The panel being written; the email-off panel reads the switched-off school. */
let emailOff = false;
const WHATSAPP = {
  settings: { enabled: true, phoneNumberId: null },
  platform: { configured: true, senderPhoneNumberId: '1', problem: null },
  templates: [{ kind: 'ABSENCE_NOTICE', name: 'sckools_absence_notice', body: '{{1}}: {{2}} was marked absent on {{3}}.' }],
  thisMonth: { READ: 12_840, DELIVERED: 3_102, FAILED: 211 },
  recent: [],
};

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('rajeshwarimemorialschool.sckools.com');
  vi.mocked(useApi).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p === '/manage/years') return YEARS;
      if (p === '/manage/periods') return PERIODS;
      if (p === '/manage/school/working-days') return { workingDays: [1, 2, 3, 4, 5, 6] };
      if (p === '/manage/school/class-note-visibility') return { classNoteVisibility: 'SUBJECT_TEACHERS' };
      if (p === '/manage/tv') return { enabled: true, url: `https://rajeshwarimemorialschool.sckools.com/tv?key=7f3a9c0e2b51d8e4a6f1c3b9d7e0a2f4` };
      if (p === '/manage/email-settings') return emailOff ? { ...EMAIL, settings: { ...EMAIL.settings, enabled: false } } : EMAIL;
      if (p === '/manage/whatsapp-settings') return WHATSAPP;
      return [];
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as never);
});

async function markup(node: React.ReactNode, after?: (host: HTMLElement) => void): Promise<string> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  const settle = async () => {
    let previous = '';
    for (let i = 0; i < 10 && host.innerHTML !== previous; i += 1) {
      previous = host.innerHTML;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
  };
  await settle();
  if (after) { await act(async () => { after(host); }); await settle(); }
  const html = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return html;
}

const click = (testId: string) => (h: HTMLElement) => (h.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null)?.click();

it('writes the real Settings tabs for a browser to measure', async () => {
  const panels: [string, string, React.ReactNode, ((h: HTMLElement) => void)?][] = [
    ['Settings · School year', '/app/settings', <SchoolYearPage />],
    ['Settings · Notifications · overview', '/app/settings/notifications', <NotificationsPage />],
    ['Settings · Notifications · email', '/app/settings/notifications', <NotificationsPage />, click('notif-part-email')],
    ['Settings · Notifications · email switched off', '/app/settings/notifications', <NotificationsPage />, click('notif-part-email')],
    ['Settings · Notifications · WhatsApp & phone', '/app/settings/notifications', <NotificationsPage />, click('notif-part-whatsapp')],
    ['Settings · General', '/app/settings/general', <GeneralPage />],
  ];
  const parts: string[] = [];
  for (const [name, path, node, after] of panels) {
    pathname = path;
    emailOff = name.endsWith('switched off');
    window.history.replaceState(null, '', path);
    const html = await markup(<><SettingsTabs />{node}</>, after);
    expect(html.length, name).toBeGreaterThan(800);
    expect(html, `${name} uses no stretching card grid`).not.toMatch(/sk-grid2/);
    if (emailOff) expect(html, `${name} shows the off note`).toMatch(/data-testid="email-off-note"/);
    expect(html, `${name} keeps logs off the page`).not.toMatch(/data-testid="(email|whatsapp)-recent"/);
    parts.push(`<section class="panel" data-panel="${name}"><h2 class="panel-h">${name}</h2><main class="skosx sk-anim min-w-0 flex-1 overflow-auto overflow-x-hidden p-6 sm:p-10" style="background:var(--sk-paper)">${html}</main></section>`);
  }
  writeFileSync(resolve(process.cwd(), 'audit/settings.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0}.panel{margin:0 0 40px;border-bottom:12px solid #000}.panel-h{position:sticky;top:0;z-index:99;margin:0;padding:6px 16px;background:#111;color:#fff;font:700 12px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
main.skosx{display:block}</style>
</head><body>${parts.join('\n')}</body></html>`);
  console.log(`wrote audit/settings.html — ${parts.length} panels`);
});
