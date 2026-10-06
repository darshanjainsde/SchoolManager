// apps/web/app/app/enquiries/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
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

interface Opts {
  leads?: Lead[]; post?: ApiStub['post']; meGet?: () => Promise<unknown>;
  /** While set, the list endpoint waits for it — a slow refetch. */
  listGate?: { current: Promise<void> | null };
}

function mount(me: Record<string, unknown>, opts: Opts = {}): ApiStub & { listed: Lead[] } {
  const listed = opts.leads ?? [MINE, FREE];
  const api = {
    listed,
    get: vi.fn(async (path: string) => {
      if (path === '/auth/me') return opts.meGet ? opts.meGet() : me;
      if (path === '/site/enquiries') { await opts.listGate?.current; return [...listed]; }
      if (path === '/site/enquiries/owners') return [];
      const row = listed.find((l) => path.endsWith(`/${l.id}`)) ?? FREE;
      return { ...row, notes: [] };
    }),
    post: opts.post ?? vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
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

  it('a newly added enquiry is the one opened, even though the list has not refetched yet', async () => {
    const created = lead('L9', { parentName: 'Brand New Parent', ownerUserId: 'u-off', ownerName: 'Sunita Kale', ownerOnDesk: true, source: 'WALK_IN' });
    const listed = [MINE, FREE];
    let openList!: () => void;
    const listGate: { current: Promise<void> | null } = { current: null };
    const post = vi.fn(async () => {
      // The row exists on the server only once the POST has landed, and the
      // refetch that would show it is slow.
      listed.push(created);
      listGate.current = new Promise<void>((r) => { openList = r; });
      return { id: 'L9' };
    });
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' }, { leads: listed, post, listGate });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /^Unowned/ })); // away from home, so the new lead would be hidden
    await waitFor(() => expect(rows()[0]).toHaveTextContent('Free Parent'));

    fireEvent.click(screen.getByRole('button', { name: 'Add enquiry' }));
    fireEvent.change(await screen.findByLabelText(/Parent/), { target: { value: 'Brand New Parent' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));

    expect(await screen.findByRole('heading', { name: 'Brand New Parent' })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); // the list is still stale; the lead must stay open
    expect(screen.getByRole('heading', { name: 'Brand New Parent' })).toBeInTheDocument();
    await act(async () => { openList(); });
    await waitFor(() => expect(screen.getByRole('button', { name: /^My leads/ })).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(rows().some((r) => r.textContent?.includes('Brand New Parent'))).toBe(true));
    expect(screen.getByRole('heading', { name: 'Brand New Parent' })).toBeInTheDocument();
  });

  it('a failed refetch while a new lead is pending lets go of it, rather than holding it open forever', async () => {
    const created = lead('L9', { parentName: 'Brand New Parent', ownerUserId: 'u-off', ownerName: 'Sunita Kale', ownerOnDesk: true, source: 'WALK_IN' });
    const listed = [MINE, FREE];
    const listGate: { current: Promise<void> | null } = { current: null };
    const post = vi.fn(async () => {
      listed.push(created);
      // The refetch that would show it fails — after the new lead has had time to open.
      listGate.current = new Promise<void>((_, reject) => setTimeout(() => reject(new Error('offline')), 150));
      listGate.current.catch(() => {});
      return { id: 'L9' };
    });
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' }, { leads: listed, post, listGate });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Add enquiry' }));
    fireEvent.change(await screen.findByLabelText(/Parent/), { target: { value: 'Brand New Parent' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));
    expect(await screen.findByRole('heading', { name: 'Brand New Parent' })).toBeInTheDocument();
    // The pending lead is let go once the refetch has failed: the desk is back on a lead it can see.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Mine Parent' })).toBeInTheDocument(), { timeout: 4000 });
  });

  it('a late answer to a write on one lead cannot reach the lead now open', async () => {
    let release!: (v: unknown) => void;
    const post = vi.fn(() => new Promise((r) => { release = r; }));
    mount({ userId: 'u-adm', role: 'SCHOOL_ADMIN', staffRole: null }, { post });
    await waitFor(() => expect(rows()).toHaveLength(2));
    const noteBox = async () => (await screen.findByLabelText('Add a note')) as HTMLInputElement;

    fireEvent.change(await noteBox(), { target: { value: 'A note' } });
    fireEvent.keyDown(await noteBox(), { key: 'Enter' });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    fireEvent.click(rows().find((r) => r.textContent?.includes('Free Parent'))!);
    await screen.findByRole('heading', { name: 'Free Parent' });
    fireEvent.change(await noteBox(), { target: { value: 'B note' } });

    await act(async () => { release({}); });
    expect((await noteBox()).value).toBe('B note');
  });

  it('shows no lead, and fetches none, until /auth/me says whose desk this is', async () => {
    let answer!: (v: unknown) => void;
    const api = mount({}, { meGet: () => new Promise((r) => { answer = r; }) });
    await screen.findByText('Reading the enquiries…');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/site/enquiries'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); // the list has landed; /auth/me has not
    expect(screen.queryByRole('listbox', { name: 'Leads' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/site/enquiries/L1');
    expect(api.get).not.toHaveBeenCalledWith('/site/enquiries/L2');
    await act(async () => { answer({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' }); });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent('Mine Parent');
    expect(api.get).not.toHaveBeenCalledWith('/site/enquiries/L2');
  });

  it('switching summary tile starts the list from the first page again', async () => {
    const many = Array.from({ length: 250 }, (_, i) => lead(`M${i}`, { parentName: `Family ${i}`, createdAt: `2026-09-01T05:00:${String(i % 60).padStart(2, '0')}.000Z` }));
    mount({ userId: 'u-adm', role: 'SCHOOL_ADMIN', staffRole: null }, { leads: many });
    await waitFor(() => expect(rows()).toHaveLength(200));
    fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
    await waitFor(() => expect(rows()).toHaveLength(250));
    fireEvent.click(screen.getByRole('button', { name: /^Never contacted/ })); // all 250 are NEW
    await waitFor(() => expect(rows()).toHaveLength(200));
    expect(screen.getByRole('button', { name: 'Show 50 more' })).toBeInTheDocument();
  });

  it('draws 200 rows of 250 and a button for the rest', async () => {
    const many = Array.from({ length: 250 }, (_, i) => lead(`M${i}`, { parentName: `Family ${i}`, createdAt: `2026-09-01T05:00:${String(i % 60).padStart(2, '0')}.000Z` }));
    mount({ userId: 'u-adm', role: 'SCHOOL_ADMIN', staffRole: null }, { leads: many });
    await waitFor(() => expect(rows()).toHaveLength(200));
    fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
    await waitFor(() => expect(rows()).toHaveLength(250));
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).not.toBeInTheDocument();
  });
});
