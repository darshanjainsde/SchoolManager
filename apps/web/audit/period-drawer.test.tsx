// @vitest-environment jsdom
/**
 * Renders the REAL period drawer in its fullest state — a swap with the other
 * periods ticked, one clash, one leave warning, long names — and writes it for
 * measure.html. The drawer is portalled (kit Overlay), so it is collected from
 * <body> and written after </main>, where the app puts it; <body> itself is
 * NOT themed here, so a drawer that lost its `.skosx` scope would show.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { PeriodDialog, type PreviewRow } from '@/components/timetable/PeriodDialog';

const row = (over: Partial<PreviewRow>): PreviewRow => ({
  dayOfWeek: 1, periodId: 'p1', periodLabel: 'I', periodOrder: 1, clicked: false,
  current: { subjectId: 'eng', teacherId: 'k', teacherName: 'Krishnamurthy Venkataraghavan' }, clash: null, warnings: [], ...over,
});

describe('audit: the period drawer', () => {
  it('writes audit/period-drawer.html', async () => {
    const preview = vi.fn().mockResolvedValue({
      teacher: { id: 'r', name: 'Rajeshwari Balasubramanian', active: true }, subject: { id: 'eng', name: 'English' }, from: '2026-10-07', until: null,
      rows: [
        row({ dayOfWeek: 4, periodId: 'p4', periodLabel: 'IV', clicked: true, current: null, warnings: ['On leave Thu 15 Oct — this period will need cover.'] }),
        row({ dayOfWeek: 1 }), row({ dayOfWeek: 2, clash: { classLabel: 'VII-A', from: 'Mon 2 Nov 2026' } }), row({ dayOfWeek: 3, periodId: 'p7', periodLabel: 'VII' }),
        row({ dayOfWeek: 5, periodId: 'p3', periodLabel: 'III', warnings: ['Cover is already arranged here on Fri 9 Oct 2026 for Krishnamurthy Venkataraghavan — check it in Leave.'] }),
        row({ dayOfWeek: 6, periodId: 'p4', periodLabel: 'IV' }),
      ],
      alreadyTheirs: 1, load: { now: 24 },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <main className="skosx">
          <PeriodDialog
            mode="change" dayLabel="Thu Oct 8" dayOfWeek={4} periodId="p4" periodLabel="IV" classLabel="V-B" weekLabel="Oct 5–11, 2026" fromLabel="today" nextWeekLabel="Mon Oct 12"
            subjects={[{ id: 'eng', label: 'English (ENG)' }]} teachers={[{ id: 'k', label: 'Krishnamurthy Venkataraghavan' }, { id: 'r', label: 'Rajeshwari Balasubramanian' }]}
            initial={{ subjectId: 'eng', teacherId: 'r', teacherName: 'Krishnamurthy Venkataraghavan' }}
            preview={preview} onSave={vi.fn()} isSaving={false} onClose={vi.fn()}
          />
        </main>,
      );
    });
    for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    const also = [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => c.closest('label')?.textContent?.includes('Also give'));
    expect(also).toBeTruthy();
    await act(async () => { also!.click(); });
    const scrim = document.body.querySelector('.sk-scrim');
    expect(scrim).not.toBeNull();
    expect(scrim!.textContent).toContain('Save 5 periods');
    writeFileSync(resolve(process.cwd(), 'audit/period-drawer.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0;min-height:100vh}</style>
</head><body><main class="skosx"><section class="audit-panel"><p class="audit-h">Period drawer · swap with clash and warnings</p></section></main>${scrim!.outerHTML}</body></html>`);
    root.unmount();
  });
});
