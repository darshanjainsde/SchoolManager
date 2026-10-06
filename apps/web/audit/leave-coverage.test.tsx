// @vitest-environment jsdom
// apps/web/audit/leave-coverage.test.tsx
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
import AdminLeavePage from '@/app/app/leave/page';

/**
 * The Leave desk's Coverage tab at the size a real week reaches: forty gaps,
 * the longest class and period names a school writes, full Indian names, and
 * a picker with forty free teachers in it. Measured by measure.html.
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NAMES = ['Rajeshwari Balasubramanian', 'Mohammed Irfan Qureshi', 'Aadhya Venkataraghavan', 'Saanvi Krishnamurthy', 'Priya Nair'];
const CLASSES = ['Grade 11 — Science (PCM with Computer Science)', 'Grade 7 — B', 'Grade 12 — Commerce with Applied Mathematics', 'Nursery — Sunflower'];
const PERIODS = ['Period VIII — 4 × 100 m relay Senior Girls practice', 'Period I', 'Period IV — Hindi (Second Language)', 'Zero period'];

const GAPS = Array.from({ length: 40 }, (_, i) => {
  const covered = i % 3 !== 0;
  return {
    id: `g${i}`,
    date: `2026-10-${String(7 + (i % 5)).padStart(2, '0')}T00:00:00.000Z`,
    classSectionId: `c${i}`,
    classSectionName: CLASSES[i % CLASSES.length],
    periodId: `p${i % 8}`,
    periodLabel: PERIODS[i % PERIODS.length],
    originalTeacherName: NAMES[i % NAMES.length],
    substituteTeacherId: covered ? `t${i}` : null,
    substituteTeacherName: covered ? NAMES[(i + 2) % NAMES.length] : null,
    acknowledgedAt: covered && i % 2 ? '2026-10-07T02:40:00.000Z' : null,
  };
});

const CANDIDATES = Array.from({ length: 40 }, (_, i) => ({
  id: `cand${i}`,
  name: `${NAMES[i % NAMES.length]} ${i}`,
  teachesSubject: i < 3,
  coversThatDay: i % 4,
}));

const halfApp = (id: string, name: string, part: 'AM' | 'PM' | null, status = 'PENDING') => ({
  id, teacherId: `t-${id}`, teacherName: name, personUserId: null, type: 'CASUAL', startDate: '2026-10-08T00:00:00.000Z', endDate: '2026-10-08T00:00:00.000Z',
  halfDay: true, halfDayPart: part, reason: 'Parent-teacher meeting at my daughter’s school in Malviya Nagar', status, createdAt: '2026-10-01T00:00:00.000Z',
});

let candidates: (id: string) => Promise<unknown> = async () => CANDIDATES;
beforeEach(() => {
  candidates = async () => CANDIDATES;
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p === '/auth/me') return { userId: 'u-admin' };
      if (p.includes('status=PENDING')) return [halfApp('a', NAMES[0], 'AM'), halfApp('b', NAMES[1], 'PM'), halfApp('c', NAMES[2], null)];
      if (p.includes('status=APPROVED')) return [halfApp('d', NAMES[3], 'PM', 'APPROVED')];
      if (p.startsWith('/manage/leave/coverage')) return GAPS;
      const m = /^\/manage\/substitution\/([^/]+)\/candidates$/.exec(p);
      if (m) return candidates(m[1]);
      return {};
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as never);
});

type Step = (host: HTMLElement) => void;

async function run(node: React.ReactNode, steps: Step[] = []): Promise<string> {
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
  const html = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return html;
}

const tab = (name: string): Step => (host) => {
  [...host.querySelectorAll('[role="tab"]')].find((b) => (b.textContent ?? '').startsWith(name))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const openFirstPicker: Step = (host) => {
  (host.querySelector('select[aria-label^="Substitute for"]') as HTMLSelectElement | null)?.focus();
};

it('writes the real Leave desk Coverage tab for a browser to measure', async () => {
  const panels: [string, Step[], (() => void)?][] = [
    ['Leave — pending, half days', []],
    ['Leave — approved, half day', [tab('Approved')]],
    ['Coverage — 40 gaps', [tab('Coverage')]],
    ['Coverage — a picker opened, 40 free', [tab('Coverage'), openFirstPicker]],
    ['Coverage — a picker opened, nobody free', [tab('Coverage'), openFirstPicker], () => { candidates = async () => []; }],
  ];
  const parts: string[] = [];
  for (const [name, steps, before] of panels) {
    before?.();
    const html = await run(<AdminLeavePage />, steps);
    expect(html.length, name).toBeGreaterThan(500);
    parts.push(`<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${html}</section>`);
  }
  const body = parts.join('\n');
  writeFileSync(resolve(process.cwd(), 'audit/leave-coverage.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>
*{animation:none!important;transition:none!important}
body{margin:0;padding:10px;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px}</style>
</head><body><main class="skosx sk-anim" style="padding:24px">${body}</main></body></html>`);

  expect(body, 'the half day named its half').toContain('Half day · morning');
  expect(body, 'the old half day said just Half day').toMatch(/Half day(?! · (morning|afternoon))/);
  expect(body, 'the long class name rendered').toContain('Grade 11 — Science (PCM with Computer Science)');
  expect(body, 'the long period rendered').toContain('4 × 100 m relay Senior Girls');
  expect(body, 'the seen line rendered').toMatch(/seen 8:10\sam/);
  expect(body, 'the not-yet-seen line rendered').toContain('not yet seen');
  expect((body.match(/class="sk-rowline/g) ?? []).length, 'all forty gaps rendered (x3 coverage panels)').toBe(120);
  expect(body, 'the opened picker listed forty free teachers').toContain('Saanvi Krishnamurthy 38');
  expect(body, 'the empty picker said so').toContain('Nobody is free that period');
  console.log(`wrote audit/leave-coverage.html — ${body.length} bytes`);
});
