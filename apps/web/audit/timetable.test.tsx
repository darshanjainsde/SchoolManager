// @vitest-environment jsdom
/**
 * Renders the REAL timetable editor — a full week, Mon–Sat × eight periods and
 * a break, the longest subject and teacher names a school has — and writes it
 * for measure.html. Since 2026-10-07 every filled period is a button that opens
 * "Change period", so each one is a tap target that has to clear 24px on a
 * phone, and the grid must scroll inside its own box rather than the page.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { TimetableEditor } from '@/components/timetable/TimetableEditor';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const P = (i: number, label: string, start: string, end: string, kind = 'CLASS') => ({ id: `p${i}`, label, order: i, startTime: start, endTime: end, kind });
const PERIODS = [
  P(1, 'I', '08:00', '08:45'), P(2, 'II', '08:45', '09:30'), P(3, 'III', '09:30', '10:15'), P(4, 'Break', '10:15', '10:35', 'BREAK'),
  P(5, 'IV', '10:35', '11:20'), P(6, 'V', '11:20', '12:05'), P(7, 'VI', '12:05', '12:50'), P(8, 'VII', '12:50', '13:35'), P(9, 'Period 10', '13:35', '14:20'),
];
const SUBJECTS = ['Computer Science', 'Physical Education', 'Social Science', 'Mathematics', 'English', 'Hindi'];
const TEACHERS = ['Krishnamurthy Venkataraghavan', 'Rajeshwari Balasubramanian', 'Mohammed Irfan Qureshi', 'Harpreet Singh Sandhu', 'Kiara Pillai', 'Sandeep Chauhan'];
const SLOTS = [] as unknown[];
for (let d = 1; d <= 6; d += 1) {
  for (const p of PERIODS.filter((x) => x.kind === 'CLASS')) {
    if ((d + p.order) % 7 === 0) continue; // a few empty periods, so the "+" cells render too
    const i = (d * 3 + p.order) % SUBJECTS.length;
    SLOTS.push({
      id: `s${d}${p.order}`, classSectionId: 'vb', dayOfWeek: d, periodId: p.id, subjectId: `sub${i}`, teacherId: `t${i}`, academicYearId: 'y1',
      period: { order: p.order, label: p.label, startTime: p.startTime, endTime: p.endTime }, subject: { name: SUBJECTS[i], code: null },
      teacher: { firstName: TEACHERS[i].split(' ')[0], lastName: TEACHERS[i].split(' ').slice(1).join(' ') },
    });
  }
}

describe('audit: the timetable editor', () => {
  it('writes audit/timetable.html', async () => {
    vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
    vi.mocked(useApi).mockReturnValue({
      get: vi.fn(async (p: string) => {
        if (p.startsWith('/manage/periods')) return PERIODS;
        if (p.startsWith('/manage/school/working-days')) return { workingDays: [1, 2, 3, 4, 5, 6] };
        if (p.startsWith('/manage/subjects')) return SUBJECTS.map((name, i) => ({ id: `sub${i}`, name }));
        if (p.startsWith('/manage/teachers')) return TEACHERS.map((n, i) => ({ id: `t${i}`, firstName: n.split(' ')[0], lastName: n.split(' ').slice(1).join(' '), isActive: true }));
        if (p.startsWith('/manage/timetable')) return SLOTS;
        return [];
      }),
      post: vi.fn(), del: vi.fn(),
    } as never);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(host);
    await act(async () => {
      root.render(<QueryClientProvider client={client}><TimetableEditor classes={[{ id: 'vb', name: 'B', academicYearId: 'y1', grade: { name: 'V' } }]} classSectionId="vb" onClassSectionChange={vi.fn()} /></QueryClientProvider>);
    });
    for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    // A settled grid, not a spinner: every filled period is a "Change" button.
    const changeButtons = host.querySelectorAll('.sk-tt-cellbtn');
    expect(changeButtons.length).toBeGreaterThan(30);
    expect(host.textContent).toContain('Krishnamurthy Venkataraghavan');
    writeFileSync(resolve(process.cwd(), 'audit/timetable.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0;padding:10px;background:var(--sk-bg,#fff)}</style>
</head><body><main class="skosx"><section class="audit-panel" data-panel="timetable"><p class="audit-h">Timetable · V-B · full week, long names</p>${host.innerHTML}</section></main></body></html>`);
    root.unmount();
  });
});
