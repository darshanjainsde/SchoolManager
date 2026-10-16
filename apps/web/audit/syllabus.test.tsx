// @vitest-environment jsdom
/**
 * Renders the REAL syllabus pages — the admin overview at a real school's
 * size (12 sections × 5 subjects, long names), the chapter editor, the
 * teacher's track and the child's subject — and writes them for measure.html.
 */
import React from 'react';
import { it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { CHAPTERS, OVERVIEW, STUDENT_SUBJECT, TRACK, track } from '@/test/fixtures/syllabus';
import type { SyllabusOverview } from '@skoolos/types';
import OverviewPage from '@/app/app/syllabus/page';
import ChaptersPage from '@/app/app/syllabus/chapters/page';
import TeacherListPage from '@/app/teacher/syllabus/page';
import TeacherTrackPage from '@/app/teacher/syllabus/[classSectionId]/[subjectId]/page';
import PortalSubjectPage from '@/app/portal/syllabus/[subjectId]/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const params = new URLSearchParams('gradeId=g9&subjectId=s-mat');
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useParams: () => ({ classSectionId: 'cs-9a', subjectId: 's-mat' }),
  usePathname: () => '/app/syllabus',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/** A real school: 12 sections, 5 subjects, the longest names on the roll. */
const TEACHERS = ['Rajeshwari Balasubramanian', 'Mohammed Irfan Qureshi', 'Aadhya Venkataraghavan', 'Harpreet Singh Sandhu', 'Saanvi Krishnamurthy'];
const SUBJECTS = [['s-mat', 'Mathematics'], ['s-sci', 'Science'], ['s-sst', 'Social Science'], ['s-eng', 'English Language and Literature'], ['s-hin', 'Hindi']];
const GRADES = [['g6', 'Class 6', 6], ['g7', 'Class 7', 7], ['g8', 'Class 8', 8], ['g9', 'Class 9', 9]] as const;
const sections = GRADES.flatMap(([gid, gname]) => ['A', 'B', 'C'].map((s) => ({ id: `${gid}-${s}`, gradeId: gid, name: s, label: `${gname}-${s}` })));
const BIG: SyllabusOverview = {
  ...OVERVIEW,
  grades: GRADES.map(([id, name, order]) => ({ id, name, order })),
  sections,
  subjects: SUBJECTS.map(([id, name]) => ({ id, name })),
  teachers: TEACHERS.map((name, i) => ({ id: `t${i}`, name })),
  tracks: sections.flatMap((sec, i) => SUBJECTS.map(([sid, sname], j) => {
    const pct = (i * 7 + j * 13) % 100;
    const gap = 55 - pct;
    return track({
      classSectionId: sec.id, className: sec.label, gradeId: sec.gradeId, gradeName: sec.label.split('-')[0]!, gradeOrder: GRADES.find((g) => g[0] === sec.gradeId)![2], sectionName: sec.name,
      subjectId: sid, subjectName: sname, teacher: j === 4 && i % 3 === 0 ? null : { id: `t${(i + j) % 5}`, name: TEACHERS[(i + j) % 5]! },
      leaves: 14, done: Math.round(pct * 0.14), pct, pace: pct === 0 ? 'none' : gap <= 5 ? 'ok' : gap <= 15 ? 'warn' : 'bad',
      now: pct >= 100 ? null : { chapterId: 'c', title: ['Linear equations in two variables', 'Atoms and molecules', 'The French Revolution', 'The Fun They Had', 'दो बैलों की कथा'][j]! },
    });
  })),
};

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
  vi.mocked(useApi).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p === '/manage/syllabus/overview') return BIG;
      if (p === '/manage/syllabus/mine') return { year: OVERVIEW.year, tracks: OVERVIEW.tracks.slice(0, 3) };
      if (p.startsWith('/manage/syllabus/tracks/')) return TRACK;
      if (p.startsWith('/manage/syllabus/chapters')) return CHAPTERS;
      if (p.startsWith('/me/syllabus/subjects/')) return STUDENT_SUBJECT;
      if (p.startsWith('/auth/me')) return { features: ['MANAGEMENT', 'COURSE_MANAGEMENT'] };
      return [];
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), download: vi.fn(), postForm: vi.fn(),
  } as never);
});

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

it('writes the real syllabus screens for a browser to measure', async () => {
  const panels: [string, React.ReactNode, string, ((h: HTMLElement) => void)?][] = [
    ['Admin · overview, 60 tracks', <OverviewPage />, 'Venkataraghavan'],
    // The drawer is the kit's Overlay and portals out of the host (it is measured by the period-drawer and settings audits); the status filter is measured here instead.
    ['Admin · behind only', <OverviewPage />, 'Behind', (h) => { const sel = h.querySelector('[data-testid="syl-f-pace"]') as HTMLSelectElement | null; if (sel) { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!; setter.call(sel, 'bad'); sel.dispatchEvent(new Event('change', { bubbles: true })); } }],
    ['Admin · chapter lists', <ChaptersPage />, 'Zeroes of a polynomial'],
    ['Teacher · my classes', <TeacherListPage />, 'Coordinate geometry'],
    ['Teacher · a track', <TeacherTrackPage />, '13 pts behind'],
    ['Teacher · note open', <TeacherTrackPage />, 'Save note', (h) => (h.querySelector('[data-testid="syl-note-edit-c3"]') as HTMLElement | null)?.click()],
    ['Student · a subject', <PortalSubjectPage />, 'Rational vs irrational'],
  ];
  const parts: string[] = [];
  for (const [name, node, must, after] of panels) {
    const html = await markup(node, after);
    // A settled page, not a spinner: the fixture value is on screen.
    expect(html, name).toContain(must);
    parts.push(`<section class="panel" data-panel="${name}"><h2 class="panel-h">${name}</h2><main class="skosx sk-anim min-w-0 flex-1 overflow-auto overflow-x-hidden p-6 sm:p-10" style="background:var(--sk-paper)">${html}</main></section>`);
  }
  writeFileSync(resolve(process.cwd(), 'audit/syllabus.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0}.panel{margin:0 0 40px;border-bottom:12px solid #000}.panel-h{position:sticky;top:0;z-index:99;margin:0;padding:6px 16px;background:#111;color:#fff;font:700 12px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
main.skosx{display:block}</style>
</head><body>${parts.join('\n')}</body></html>`);
  console.log(`wrote audit/syllabus.html — ${parts.length} panels`);
});
