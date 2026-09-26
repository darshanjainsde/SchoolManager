/**
 * Renders the REAL Teachers page — the card grid the buttons ran out of on a
 * wide monitor — with a realistic roll, and writes it for measure.html.
 * Widths 1440 and 1920 were added to the measurer for exactly this class of
 * defect: auto-fill parks every column at its minimum on a big screen.
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
import TeachersPage from '@/app/app/teachers/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app/teachers', useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Longest realistic names and both login states, so every button variant renders. */
const NAMES = [
  ['Rajeshwari', 'Balasubramanian'], ['Mohammed Irfan', 'Qureshi'], ['Aadhya', 'Venkataraghavan'], ['Kabir', 'Bhat'],
  ['Saanvi', 'Krishnamurthy'], ['Lakshmi', 'Venkataraman'], ['Aarav', 'Mehta'], ['Priya', 'Iyer'], ['Harpreet', 'Singh Sandhu'],
];
const TEACHERS = NAMES.map(([firstName, lastName], i) => ({
  id: `t${i}`, firstName, lastName, email: i % 3 === 2 ? null : `${firstName.split(' ')[0].toLowerCase()}.${lastName.split(' ')[0].toLowerCase()}@raffles.sckools.com`,
  username: i % 2 === 0 ? `${firstName.split(' ')[0].toLowerCase()}${i}` : null, userId: i % 2 === 0 ? `u${i}` : null,
  isActive: i !== 7, status: i === 7 ? 'LEFT' : 'ACTIVE', leftOn: i === 7 ? '2026-03-31' : null, photoAssetId: null,
}));

describe('audit: the teachers page', () => {
  it('writes audit/teachers.html', async () => {
    vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
    vi.mocked(useApi).mockReturnValue({
      get: vi.fn(async (p: string) => {
        if (p.startsWith('/manage/teachers')) return TEACHERS;
        if (p.startsWith('/auth/me')) return { features: ['MANAGEMENT'] };
        return [];
      }),
      post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), request: vi.fn(),
    } as never);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const root = createRoot(host);
    await act(async () => { root.render(<QueryClientProvider client={client}><TeachersPage /></QueryClientProvider>); });
    let previous = '';
    for (let i = 0; i < 10 && host.innerHTML !== previous; i += 1) {
      previous = host.innerHTML;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    // A settled page, not a spinner: the roll is on screen.
    expect(host.textContent).toContain('Balasubramanian');
    expect(host.querySelectorAll('.sk-cardgrid .sk-entity').length).toBe(TEACHERS.length);
    writeFileSync(resolve(process.cwd(), 'audit/teachers.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0;padding:10px;background:var(--sk-bg,#fff)}</style>
</head><body class="skosx"><main class="skosx"><section class="audit-panel"><p class="audit-h">Teachers · nine on the roll</p>${host.innerHTML}</section></main></body></html>`);
    root.unmount();
  });
});
