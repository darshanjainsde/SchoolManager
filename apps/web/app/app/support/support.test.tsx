import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupportSchoolCounts, SupportTicketDetail, SupportTicketRow } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import SupportPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const COUNTS: SupportSchoolCounts = { open: 2, waitingOnYou: 1, closed: 11 };

const row = (over: Partial<SupportTicketRow> = {}): SupportTicketRow => ({
  id: 't1', number: 142, ticketNo: 'SK-000142', type: 'BUG', module: 'FEES', severity: 'BLOCKING',
  title: 'Receipt PDF fails for one student', status: 'WAITING_ON_SCHOOL',
  createdAt: '2026-10-23T04:00:00.000Z', lastActivityAt: '2026-10-24T04:00:00.000Z', lastSchoolActivityAt: '2026-10-23T04:00:00.000Z',
  lastOwnerActivityAt: '2026-10-24T04:00:00.000Z', resolvedAt: null, closedAt: null, reopenedAt: null, unanswered: false,
  lookInUntil: null, entryCount: 2, raisedBy: { name: 'Priya Nair' }, school: null, ...over,
});

const detail = (over: Partial<SupportTicketDetail> = {}): SupportTicketDetail => ({
  ...row(), body: 'Pressing Print receipt shows "Something went wrong".',
  attachments: [{ key: 'support/s/t/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-shot.png', name: 'shot.png' }],
  context: { pagePath: '/app/fees/counter', tier: 'PRO', browser: 'Chrome on Windows', appVersion: null },
  entries: [
    { id: 'e1', authorKind: 'OWNER', authorName: 'Darshan', body: 'Could you set a category for the student and try again?', attachments: [], visibleToSchool: true, statusFrom: 'IN_PROGRESS', statusTo: 'WAITING_ON_SCHOOL', createdAt: '2026-10-24T04:00:00.000Z' },
  ],
  canReopen: false, canConfirm: false, assignedTo: null, externalRef: null, sameModuleOpen: 0, ...over,
});

function api(handlers: Record<string, unknown>, post?: (p: string, b?: unknown) => unknown): ApiStub & { postForm: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(async (p: string) => {
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => p.startsWith(k));
      if (!key) throw new Error(`no stub for ${p}`);
      const v = handlers[key];
      if (v instanceof Error) throw v;
      return v;
    }),
    post: vi.fn(async (p: string, b?: unknown) => (post ? post(p, b) : detail())),
    postForm: vi.fn(async () => detail()),
    put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('the school’s Help page', () => {
  it('shows the ticket with its number and "Waiting on you" in amber, and opens the thread in a drawer outside the page', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/manage/support/counts': COUNTS,
      '/manage/support/t1': detail(),
      '/manage/support': [row(), row({ id: 't2', ticketNo: 'SK-000139', title: 'Timetable shows Friday twice', status: 'IN_PROGRESS', severity: 'ANNOYING', module: 'TIMETABLE' })],
    }));
    const { container } = renderWithProviders(<SupportPage />);

    const waiting = (await screen.findByText('Waiting on you', { selector: '.sk-kpi *' })).closest('.sk-kpi')!;
    expect(waiting).toHaveAttribute('data-tone', 'warn');

    const first = screen.getByTestId('ticket-t1');
    expect(first).toHaveTextContent('SK-000142');
    expect(first).toHaveTextContent('Receipt PDF fails for one student');
    expect(within(first).getByText('Waiting on you', { selector: '.sk-pill' })).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByTestId('ticket-t2')).toHaveTextContent('In progress');

    await user.click(first);
    const dialog = await screen.findByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(within(dialog).getByText('Receipt PDF fails for one student')).toBeInTheDocument();
    expect(within(dialog).getByText('Chrome on Windows')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /shot\.png/ })).toBeInTheDocument();
    // The owner's move is on the timeline in the school's words.
    expect(within(dialog).getByText('In progress → Waiting on you')).toBeInTheDocument();
  });

  it('offers "Yes, it\'s fixed" on a resolved ticket and Reopen inside the window, and the look-in switch', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api({
      '/manage/support/counts': COUNTS,
      '/manage/support/t1': detail({ status: 'RESOLVED', canConfirm: true, canReopen: true }),
      '/manage/support': [row({ status: 'RESOLVED' })],
    });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<SupportPage />);
    await user.click(await screen.findByTestId('ticket-t1'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: "Yes, it's fixed" }));
    await waitFor(() => expect(stub.post).toHaveBeenCalledWith('/manage/support/t1/confirm', {}));

    await user.type(within(dialog).getByLabelText('Say what is still wrong'), 'It came back.');
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(stub.post).toHaveBeenCalledWith('/manage/support/t1/reopen', { body: 'It came back.' }));

    await user.click(within(dialog).getByRole('checkbox', { name: /Allow Sckools to open our console/ }));
    await waitFor(() => expect(stub.post).toHaveBeenCalledWith('/manage/support/t1/look-in', { allow: true }));
  });

  it('sends a reply with its photos as one form', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api({ '/manage/support/counts': COUNTS, '/manage/support/t1': detail(), '/manage/support': [row()] });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<SupportPage />);
    await user.click(await screen.findByTestId('ticket-t1'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Write to Sckools'), 'Done — still fails.');
    await user.upload(within(dialog).getByTestId('reply-files'), [new File([new Uint8Array(8)], 'again.png', { type: 'image/png' })]);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stub.postForm).toHaveBeenCalled());
    const [path, fd] = stub.postForm.mock.calls[0] as [string, FormData];
    expect(path).toBe('/manage/support/t1/comment');
    expect(fd.get('body')).toBe('Done — still fails.');
    expect(fd.getAll('files')).toHaveLength(1);
  });

  it('a failed load shows the error with a retry, never the empty copy; an empty list points at Report a problem', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({ '/manage/support/counts': COUNTS, '/manage/support': new Error('boom') }));
    const first = renderWithProviders(<SupportPage />);
    expect(await screen.findByText(/could not load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing open/)).toBeNull();
    first.unmount();

    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({ '/manage/support/counts': { open: 0, waitingOnYou: 0, closed: 0 }, '/manage/support': [] }));
    renderWithProviders(<SupportPage />);
    expect(await screen.findByText(/press Report a problem/)).toBeInTheDocument();
  });

  it('the Report button opens the same drawer the sidebar door uses', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({ '/manage/support/counts': COUNTS, '/manage/support': [] }));
    renderWithProviders(<SupportPage />);
    await user.click(await screen.findByRole('button', { name: /Report a problem/ }));
    expect(await screen.findByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument();
  });
});
