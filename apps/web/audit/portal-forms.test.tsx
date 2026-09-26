// @vitest-environment jsdom
//
// THE FAMILY'S OWN FORMS — mounted for real, not imitated.
//
// The owner sent a screenshot of "Raise a concern" with every label sitting
// BESIDE its field, the three controls at three different widths, and "WHAT
// HAPPENED" pinned to the BOTTOM of its textarea. That is not a page bug: the
// page stacks a `.sk-lab` label and a `.sk-input` control the way 62 other
// places do. `.sk-lab` sets font and colour and no `display`, so on a <label>
// it is inline — and a bare <select>/<input>/<textarea> is inline-block, so
// the pair shares a line and the label centres against the field.
//
// It only looked right elsewhere because those forms use a <Select> that
// happens to render block, which pushes the inline label onto its own line by
// accident. Two forms in the family portal use the bare controls, so both were
// wrong: this one and "record a payment" under Fees.
//
// Static markup would prove nothing here (ui-mistake-ledger:
// audited-hand-written-markup-not-the-real-component), and these pages are
// hook-driven, so this mounts them with resolved data and serialises the
// settled DOM — the same approach as pay.test.tsx next door.
import { it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import ConcernsPage from '@/app/portal/concerns/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/portal/concerns', useRouter: () => ({ replace: vi.fn() }) }));

/** The longest realistic values: a full class-teacher name, a real concern. */
const PROFILE = {
  firstName: 'Saanvi', lastName: 'Krishnamurthy',
  className: 'Class 8 B', classTeacherName: 'Rajeshwari Balasubramanian',
};
const ROWS = [
  { id: 'c1', title: 'The school bus has been late three mornings this week', category: 'TRANSPORT', status: 'OPEN', audience: 'OFFICE', createdAt: '2026-09-24T04:00:00Z', lastActivityAt: '2026-09-26T04:00:00Z', unread: true, comments: 2, student: { name: 'Saanvi Krishnamurthy', className: 'Class 8 B' }, assignedTeacher: null, escalatedAt: null, resolvedAt: null, canReopen: false },
];

const get = vi.fn(async (path: string) => {
  if (path.startsWith('/me/profile')) return PROFILE;
  if (path.startsWith('/me/concerns')) return ROWS;
  return null;
});

it('writes the family portal forms for a browser to measure', async () => {
  (useHost as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue('raffles.test.sckools.com');
  (useApi as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({ get, post: vi.fn(), put: vi.fn(), del: vi.fn() });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(host);
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><ConcernsPage /></QueryClientProvider>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

  // Open the form — it is behind the "Raise a concern" button, and a closed
  // form is exactly the markup nobody complained about.
  const open = [...host.querySelectorAll('button')].find((b) => /raise a concern/i.test(b.textContent ?? ''));
  expect(open, 'the Raise a concern button should be on the page').toBeTruthy();
  await act(async () => { open!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

  const markup = host.innerHTML;
  // Fail loudly rather than measure a form that never opened.
  expect(markup, 'the raise form must be in the serialised DOM').toContain('sk-conraise');

  const body = `<section class="audit-panel" data-panel="Family — Raise a concern (open)"><h2 class="audit-h">Family — Raise a concern (open)</h2><main class="sk-main">${markup}</main></section>`;
  writeFileSync(resolve(process.cwd(), 'audit/portal-forms.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0;padding:0;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0;padding:10px 20px 0}</style>
</head><body class="skosx sk-shell">${body}</body></html>`);
  console.log(`wrote audit/portal-forms.html — ${body.length} bytes of settled DOM`);
  root.unmount();
});
