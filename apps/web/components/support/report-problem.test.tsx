import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupportTicketDetail } from '@skoolos/types';
import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ReportProblem } from './report-problem';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const created = (): SupportTicketDetail => ({
  id: 't1', number: 142, ticketNo: 'SK-000142', type: 'BUG', module: 'FEES', severity: 'ANNOYING', title: 'Receipt PDF fails',
  status: 'OPEN', createdAt: '2026-10-24T04:00:00.000Z', lastActivityAt: '2026-10-24T04:00:00.000Z', lastSchoolActivityAt: '2026-10-24T04:00:00.000Z',
  lastOwnerActivityAt: null, resolvedAt: null, closedAt: null, reopenedAt: null, unanswered: true, lookInUntil: null, entryCount: 0,
  raisedBy: { name: 'Priya Nair' }, school: null, body: 'It fails.', attachments: [], context: null, entries: [], canReopen: false, canConfirm: false,
  assignedTo: null, externalRef: null, sameModuleOpen: 0,
});

const png = (name: string, bytes = 16) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

function stub(postForm: (p: string, fd: FormData) => Promise<unknown>) {
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn(postForm) });
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('Report a problem', () => {
  it('preselects the module from the page it was opened on, and opens as a drawer outside the page tree', async () => {
    stub(async () => created());
    const { container } = renderWithProviders(<ReportProblem pagePath="/app/fees/counter" onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Report a problem' });
    expect(container.contains(dialog)).toBe(false);
    expect((within(dialog).getByLabelText('Which part of Sckools') as HTMLSelectElement).value).toBe('FEES');
    expect(within(dialog).getByText('/app/fees/counter', { selector: 'dd' })).toBeInTheDocument();
  });

  it('marks the empty fields instead of sending, and sends every field plus the photos as one form', async () => {
    const user = userEvent.setup({ delay: null });
    let sentForm: FormData | null = null;
    stub(async (_p, fd) => { sentForm = fd; return created(); });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<ReportProblem pagePath="/app/fees" onClose={onClose} onCreated={onCreated} />);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Send to Sckools' }));
    expect(within(dialog).getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(/Give it a short title/)).toBeInTheDocument();
    expect(sentForm).toBeNull();

    await user.type(within(dialog).getByLabelText('Title'), 'Receipt PDF fails');
    await user.type(within(dialog).getByLabelText('What happened'), 'Pressing Print receipt shows an error.');
    await user.click(within(dialog).getByRole('button', { name: 'Blocking us today' }));
    await user.upload(within(dialog).getByTestId('report-files'), [png('a.png'), png('b.png')]);
    await user.click(within(dialog).getByRole('checkbox', { name: /Allow Sckools to open our console/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Send to Sckools' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const fd = sentForm!;
    expect(fd.get('type')).toBe('BUG');
    expect(fd.get('module')).toBe('FEES');
    expect(fd.get('severity')).toBe('BLOCKING');
    expect(fd.get('title')).toBe('Receipt PDF fails');
    expect(fd.get('pagePath')).toBe('/app/fees');
    expect(fd.get('allowLookIn')).toBe('true');
    expect(fd.getAll('files')).toHaveLength(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps only five photos and says which were dropped; a photo over 5 MB is refused by name', async () => {
    const user = userEvent.setup({ delay: null });
    stub(async () => created());
    renderWithProviders(<ReportProblem pagePath="/app" onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    const files = ['1', '2', '3', '4', '5', '6'].map((n) => png(`p${n}.png`));
    await user.upload(within(dialog).getByTestId('report-files'), files);
    expect(within(dialog).getAllByRole('button', { name: /^Remove / })).toHaveLength(5);
    expect(within(dialog).getByText(/p6\.png — only 5 photos fit/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Remove p5.png' }));
    const big = new File([new Uint8Array(8)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await user.upload(within(dialog).getByTestId('report-files'), [big]);
    expect(within(dialog).getByText(/huge\.png is over 5 MB/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: /^Remove / })).toHaveLength(4);
  });

  it('shows the daily cap as a note and keeps the drawer (and the words) when the server says 429', async () => {
    const user = userEvent.setup({ delay: null });
    stub(async () => { throw new ApiError(429, 'Your school has raised 20 tickets in the last day.', { code: 'SUPPORT_DAILY_LIMIT' }); });
    const onClose = vi.fn();
    renderWithProviders(<ReportProblem pagePath="/app" onClose={onClose} />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'One more');
    await user.type(within(dialog).getByLabelText('What happened'), 'Something else broke today.');
    await user.click(within(dialog).getByRole('button', { name: 'Send to Sckools' }));
    expect(await within(dialog).findByText(/raised 20 tickets/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText('Title') as HTMLInputElement).value).toBe('One more');
  });

  it("repeats the server's own words for a dead file store (503), never a generic shrug", async () => {
    const user = userEvent.setup({ delay: null });
    const words = 'The file store is unreachable right now, so the upload could not be saved.';
    stub(async () => { throw new ApiError(503, words, { code: 'STORAGE_UNAVAILABLE' }); });
    renderWithProviders(<ReportProblem pagePath="/app" onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'Photos');
    await user.type(within(dialog).getByLabelText('What happened'), 'Attached a photo of the error.');
    await user.click(within(dialog).getByRole('button', { name: 'Send to Sckools' }));
    expect(await within(dialog).findByText(words)).toBeInTheDocument();
  });
});
