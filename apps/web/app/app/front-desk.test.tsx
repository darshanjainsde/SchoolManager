import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { ConsoleSearch } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { CommandBar } from './command-bar';
import { Dock } from './dock';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

const HITS: ConsoleSearch = {
  students: [{
    id: 's1', name: 'Aarav Sharma', classLabel: 'VII-B', admissionNo: 'RPS-0790',
    rollNo: '14', isActive: true, feesDueMinor: 850000,
  }],
  teachers: [], staff: [],
  serials: [{ id: 'p1', type: 'TC', serial: 'TC/2026/0041', studentId: 's9', studentName: 'Meera Rathore' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('CommandBar', () => {
  it('typing a name surfaces the child with the live fee chip; Enter opens the 360', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue(HITS) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<CommandBar actions={[]} />);
    const input = screen.getByLabelText('Search the console');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'aarav' } });

    // Debounced 200 ms — the hit arrives, carrying its own actions.
    await waitFor(() => expect(screen.getByText('Aarav Sharma')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText(/Fees ₹8,500 due/)).toBeInTheDocument();
    expect(screen.getByText('TC/2026/0041')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/app/students/s1');
  });

  it('an action word runs the action, no navigation involved', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue({ students: [], teachers: [], staff: [], serials: [] }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    const run = vi.fn();

    renderWithProviders(
      <CommandBar actions={[{ label: 'Make an announcement', hint: 'School-wide', keywords: 'announce notice', run }]} />,
    );
    const input = screen.getByLabelText('Search the console');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'announce' } });

    await waitFor(() => expect(screen.getByText('Make an announcement')).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('Dock drawers — they post to the REAL endpoints', () => {
  it('Announce publishes school-wide via /manage/announcements, and only once both fields exist', async () => {
    const api = mockApi({ post: vi.fn().mockResolvedValue({}) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    const setOpen = vi.fn();

    renderWithProviders(<Dock hasFees={false} open="announce" setOpen={setOpen} />);

    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled(); // empty fields cannot post

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'PTM this Saturday' } });
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'From 2 pm, Class III.' } });
    fireEvent.click(publish);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/manage/announcements', {
        title: 'PTM this Saturday',
        body: 'From 2 pm, Class III.',
      }),
    );
    expect(setOpen).toHaveBeenCalledWith(null);
  });

  it('a walk-in enquiry goes down the same path as the website form', async () => {
    const api = mockApi({ post: vi.fn().mockResolvedValue({}) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<Dock hasFees={false} open="enquiry" setOpen={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Parent/), { target: { value: 'Meera Purohit' } });
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/public/enquiry', {
        parentName: 'Meera Purohit',
        phone: '98290 11223',
      }),
    );
  });

  it('without FEES the payment button simply is not there', () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi());
    renderWithProviders(<Dock hasFees={false} open={null} setOpen={vi.fn()} />);
    expect(screen.queryByText('Record payment')).not.toBeInTheDocument();
    expect(screen.getByText('New enquiry')).toBeInTheDocument();
  });
});
