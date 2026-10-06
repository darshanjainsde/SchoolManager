// apps/web/app/app/enquiries/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { saveBlob } from '@/lib/save-blob';
import EnquiriesPage from './page';
import type { Lead } from './lead';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));

const lead = (id: string, over: Partial<Lead>): Lead => ({
  id, parentName: 'Parent', childName: null, phone: '+91 98290 11223', email: null, gradeInterest: 'Class III',
  message: null, status: 'NEW', source: 'WEBSITE', whatsappOk: false, followUpAt: null, lastContactedAt: null,
  ownerUserId: null, ownerName: null, ownerOnDesk: false, lostReason: null, noteCount: 0,
  createdAt: '2026-10-01T05:00:00.000Z', updatedAt: '2026-10-01T05:00:00.000Z', ...over,
});
const MINE = lead('L1', { parentName: 'Mine Parent', ownerUserId: 'u-off', ownerName: 'Sunita Kale', ownerOnDesk: true, source: 'WALK_IN' });
const FREE = lead('L2', { parentName: 'Free Parent' });

function mount(me: Record<string, unknown>): ApiStub {
  const api: ApiStub = {
    get: vi.fn(async (path: string) => {
      if (path === '/auth/me') return me;
      if (path === '/site/enquiries') return [MINE, FREE];
      if (path === '/site/enquiries/owners') return [];
      return { ...(path.endsWith('L1') ? MINE : FREE), notes: [] };
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
  renderWithProviders(<EnquiriesPage />);
  return api;
}

const rows = () => within(screen.getByRole('listbox', { name: 'Leads' })).getAllByRole('option');

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('the admissions desk', () => {
  it('opens an officer on their own leads, with each lead’s source on its row', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent('Mine Parent');
    expect(rows()[0]).toHaveTextContent('Walk-in');
    expect(screen.getByRole('button', { name: /^My leads/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Unowned shows the leads nobody has taken', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /^Unowned/ }));
    await waitFor(() => expect(rows()[0]).toHaveTextContent('Free Parent'));
    expect(rows()).toHaveLength(1);
  });

  it('opens an admin on every open lead', async () => {
    mount({ userId: 'u-adm', role: 'SCHOOL_ADMIN', staffRole: null });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole('button', { name: /^Open/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('exports what is on screen, named for the filter and the day', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^enquiries-mine-\d{4}-\d{2}-\d{2}\.csv$/));
  });

  it('the CSV starts with a UTF-8 byte-order mark so Excel shows Devanagari names', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const blob = (saveBlob as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    // Blob.text() strips a BOM when decoding, so read the raw bytes.
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).startsWith('\uFEFF')).toBe(true);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    await screen.findByRole('heading', { name: 'Mine Parent' }); // let the open lead settle
  });

  it('Add enquiry opens the walk-in form', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add enquiry' }));
    expect(await screen.findByRole('dialog', { name: 'New enquiry' })).toBeInTheDocument();
  });
});
