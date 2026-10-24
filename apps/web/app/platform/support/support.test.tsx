import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupportBoard, SupportTicketDetail, SupportTicketRow } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import SupportPage from './page';
import SupportTicketPage from './[id]/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 't1' }), usePathname: () => '/platform/support/t1', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const H = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * H).toISOString();

const board = (): SupportBoard => ({
  counts: { unanswered: 2, pastDay: 1, inProgress: 1, waitingOnSchool: 1, open: 4 },
  schools: [
    { schoolId: 's1', name: 'Raffles Public School', slug: 'raffles', tier: 'PRO', open: 3, waitingOnSchool: 1, oldestUnansweredAt: ago(31), oldestUnansweredTitle: 'Receipt PDF fails for one student' },
    { schoolId: 's2', name: 'Little Flower Convent', slug: 'littleflower', tier: 'BASIC', open: 1, waitingOnSchool: 0, oldestUnansweredAt: ago(2), oldestUnansweredTitle: 'Website logo blurry' },
  ],
});

const row = (over: Partial<SupportTicketRow> = {}): SupportTicketRow => ({
  id: 't1', number: 142, ticketNo: 'SK-000142', type: 'BUG', module: 'FEES', severity: 'BLOCKING', title: 'Receipt PDF fails for one student',
  status: 'OPEN', createdAt: ago(31), lastActivityAt: ago(31), lastSchoolActivityAt: ago(31), lastOwnerActivityAt: null, resolvedAt: null, closedAt: null,
  reopenedAt: null, unanswered: true, lookInUntil: null, entryCount: 0, raisedBy: { name: 'Priya Nair' },
  school: { id: 's1', name: 'Raffles Public School', slug: 'raffles', tier: 'PRO' }, ...over,
});

const detail = (over: Partial<SupportTicketDetail> = {}): SupportTicketDetail => ({
  ...row(), body: 'Pressing Print receipt shows an error.', attachments: [], context: { pagePath: '/app/fees/counter', tier: 'PRO', browser: 'Chrome on Windows', appVersion: null },
  entries: [{ id: 'e1', authorKind: 'OWNER', authorName: 'Darshan', body: 'null studentCategory', attachments: [], visibleToSchool: false, statusFrom: null, statusTo: null, createdAt: ago(1) }],
  canReopen: false, canConfirm: false, assignedTo: null, externalRef: null, sameModuleOpen: 2, ...over,
});

function api(handlers: Record<string, unknown>): ApiStub {
  return {
    get: vi.fn(async (p: string) => {
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => p.startsWith(k));
      if (!key) throw new Error(`no stub for ${p}`);
      const v = handlers[key];
      if (v instanceof Error) throw v;
      return v;
    }),
    post: vi.fn(async () => detail()), patch: vi.fn(async () => detail()), put: vi.fn(), del: vi.fn(),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('the owner’s Support tab', () => {
  it('shows the board school-wise with the late school striped red and its age in hours, and the list late-first', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/owner/support/board': board(),
      '/owner/support/tickets': [row(), row({ id: 't2', ticketNo: 'SK-000143', status: 'WAITING_ON_SCHOOL', unanswered: false, lastActivityAt: ago(1), school: { id: 's2', name: 'Little Flower Convent', slug: 'littleflower', tier: 'BASIC' } })],
    }));
    renderWithProviders(<SupportPage />);
    const raffles = await screen.findByTestId('board-raffles');
    expect(raffles).toHaveAttribute('data-tone', 'bad');
    expect(raffles).toHaveTextContent('31 h');
    expect(screen.getByTestId('board-littleflower')).toHaveAttribute('data-tone', 'info');
    expect(screen.getByTestId('ticket-t1')).toHaveAttribute('data-tone', 'bad');
    expect(screen.getByTestId('ticket-t2')).toHaveAttribute('data-tone', 'warn');
    expect(within(screen.getByTestId('ticket-t2')).getByText('Waiting on school', { selector: '.sk-pill' })).toBeInTheDocument();
  });

  it('narrows the list through labelled selects, sent as the query string', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api({ '/owner/support/board': board(), '/owner/support/tickets': [row()] });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<SupportPage />);
    await screen.findByTestId('board-raffles');
    await user.selectOptions(screen.getByLabelText('Status'), 'WAITING_ON_SCHOOL');
    await user.selectOptions(screen.getByLabelText('Module'), 'FEES');
    await waitFor(() => expect(stub.get).toHaveBeenCalledWith('/owner/support/tickets?status=WAITING_ON_SCHOOL&module=FEES'));
    await user.click(within(screen.getByTestId('board-raffles')).getByRole('button', { name: 'See tickets' }));
    await waitFor(() => expect(stub.get).toHaveBeenCalledWith('/owner/support/tickets?schoolId=s1&status=WAITING_ON_SCHOOL&module=FEES'));
  });

  it('a failed board offers a retry, not a dead end', async () => {
    const stub = api({ '/owner/support/board': new Error('boom'), '/owner/support/tickets': [] });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<SupportPage />);
    expect(await screen.findByText(/board could not load/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });
});

describe('the desk for one ticket', () => {
  it('offers only the legal moves, keeps Open-as-school disabled without consent, and marks the private note', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({ '/owner/support/t1': detail() }));
    renderWithProviders(<SupportTicketPage />);
    const move = (await screen.findByLabelText('Move to')) as HTMLSelectElement;
    expect([...move.options].map((o) => o.value).filter(Boolean)).toEqual(['ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING_ON_SCHOOL', 'RESOLVED']);
    expect(screen.getByRole('button', { name: /Open as this school/ })).toBeDisabled();
    expect(screen.getByText('only the desk sees this')).toBeInTheDocument();
    expect(screen.getByText(/2 other schools have an open ticket here this week/)).toBeInTheDocument();
  });

  it('a private note is sent with visibleToSchool false; a status move carries its note; consent enables the open button', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api({ '/owner/support/t1': detail({ lookInUntil: new Date(Date.now() + 40 * H).toISOString() }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<SupportTicketPage />);
    await screen.findByLabelText('Move to');
    expect(screen.getByRole('button', { name: /Open as this school/ })).toBeEnabled();
    expect(screen.getByText(/Allowed · 40 h left/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Write to the school'), 'Internal: see #412');
    await user.click(screen.getByRole('checkbox', { name: /Private note/ }));
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(stub.post).toHaveBeenCalledWith('/owner/support/t1/comment', { body: 'Internal: see #412', visibleToSchool: false }));

    await user.selectOptions(screen.getByLabelText('Move to'), 'WAITING_ON_SCHOOL');
    await user.type(screen.getByLabelText('Note to the school'), 'Please set a category and retry.');
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(stub.post).toHaveBeenCalledWith('/owner/support/t1/status', { status: 'WAITING_ON_SCHOOL', note: 'Please set a category and retry.' }));
  });

  it('a closed ticket offers no move at all', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({ '/owner/support/t1': detail({ status: 'CLOSED' }) }));
    renderWithProviders(<SupportTicketPage />);
    expect(await screen.findByText(/Only the school can reopen it/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Move to')).toBeNull();
  });
});
