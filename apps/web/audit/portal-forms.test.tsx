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
import DiaryPage from '@/app/portal/diary/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/portal/diary', useRouter: () => ({ replace: vi.fn() }) }));

/** The longest realistic values: a full class-teacher name, a real concern. */
const PROFILE = {
  firstName: 'Saanvi', lastName: 'Krishnamurthy',
  className: 'Class 8 B', classTeacherName: 'Rajeshwari Balasubramanian',
};
const ROWS = [
  { id: 'c1', title: 'The school bus has been late three mornings this week', category: 'TRANSPORT', status: 'OPEN', audience: 'OFFICE', createdAt: '2026-09-24T04:00:00Z', lastActivityAt: '2026-09-26T04:00:00Z', unread: true, comments: 2, student: { name: 'Saanvi Krishnamurthy', className: 'Class 8 B' }, assignedTeacher: null, escalatedAt: null, resolvedAt: null, canReopen: false },
];

/**
 * A real-shaped September: Sundays shut, a two-day festival break, a remark
 * still to sign, and plenty of ordinary days with nothing written — which is
 * the state the month grid exists to show.
 */
const SEPT = Array.from({ length: 30 }, (_, i) => {
  const date = `2026-09-${String(i + 1).padStart(2, '0')}`;
  const iso = new Date(`${date}T00:00:00Z`).getUTCDay();
  const sunday = iso === 0;
  const festival = date === '2026-09-21' || date === '2026-09-22';
  const busy = !sunday && !festival && [1, 2, 4, 7, 8, 10, 11, 14, 15, 16, 18, 23, 24, 25].includes(i + 1);
  return {
    date,
    items: busy ? 2 : 0,
    remarks: date === '2026-09-17' ? 1 : 0,
    unsigned: date === '2026-09-17' ? 1 : 0,
    offReason: sunday ? 'Sunday' : festival ? 'Ganesh Chaturthi break' : null,
  };
});

const DIARY_MONTH = {
  unsignedCount: 1,
  month: { month: '2026-09', days: SEPT, firstMonth: '2026-04', lastMonth: '2027-03' },
  entries: [
    { id: 'd1', date: '2026-09-17', kind: 'REMARK', body: 'Saanvi has not brought her geometry box for three days. Please help her pack it tonight.', subjectName: null, teacherName: 'Rajeshwari Balasubramanian', personal: true, signedAt: null, signedName: null, createdAt: '2026-09-17T09:00:00Z' },
    { id: 'd2', date: '2026-09-17', kind: 'ITEM', body: 'Exercise 7.2, questions 1 to 10. Show the working.', subjectName: 'Mathematics', teacherName: 'Rajeshwari Balasubramanian', personal: false, signedAt: null, signedName: null, createdAt: '2026-09-17T09:05:00Z' },
    { id: 'd3', date: '2026-09-17', kind: 'ITEM', body: 'Sports day trials on Friday. Please send white shoes and a water bottle.', subjectName: null, teacherName: 'Mohammed Irfan Qureshi', personal: false, signedAt: null, signedName: null, createdAt: '2026-09-17T09:10:00Z' },
  ],
};

const get = vi.fn(async (path: string) => {
  if (path.startsWith('/me/profile')) return PROFILE;
  if (path.startsWith('/me/concerns')) return ROWS;
  if (path.startsWith('/me/diary')) return DIARY_MONTH;
  return null;
});

it('writes the family portal forms and the diary month for a browser to measure', async () => {
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

  const panels: string[] = [
    `<section class="audit-panel" data-panel="Family — Raise a concern (open)"><h2 class="audit-h">Family — Raise a concern (open)</h2><main class="sk-main">${markup}</main></section>`,
  ];

  // The diary's month grid, in the two states that matter: a day carrying a
  // remark to sign, and a day the school was shut.
  for (const [name, day] of [['a day with a remark to sign', '2026-09-17'], ['a day the school was shut', '2026-09-20']] as const) {
    const dh = document.createElement('div');
    document.body.appendChild(dh);
    const dqc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const droot = createRoot(dh);
    await act(async () => { droot.render(<QueryClientProvider client={dqc}><DiaryPage /></QueryClientProvider>); });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    const cell = dh.querySelector(`[data-testid="diary-day-${day}"]`) as HTMLButtonElement | null;
    expect(cell, `the ${day} square should be in the grid`).toBeTruthy();
    await act(async () => { cell!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(dh.innerHTML, 'the month grid must have rendered').toContain('sk-dcal');
    panels.push(`<section class="audit-panel" data-panel="Family — Diary month, ${name}"><h2 class="audit-h">Family — Diary month, ${name}</h2><main class="sk-main">${dh.innerHTML}</main></section>`);
    droot.unmount();
  }

  const body = panels.join('\n');
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
