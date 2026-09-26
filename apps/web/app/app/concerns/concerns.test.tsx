import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConcernCounts, ConcernDetail, ConcernRow } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import ConcernsPage from './page';
import TeacherConcernsPage from '@/app/teacher/concerns/page';
import PortalConcernsPage from '@/app/portal/concerns/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const COUNTS: ConcernCounts = { unread: 2, open: 5, withClassTeachers: 2, resolvedThisMonth: 41, medianDaysToResolve: 1.6, topCategory: 'BUS' };

const row = (over: Partial<ConcernRow> = {}): ConcernRow => ({
  id: 'c1', status: 'OPEN', category: 'BUS', audience: 'CLASS_TEACHER',
  title: 'Bus late twice this week', createdAt: '2026-09-25T04:00:00.000Z', lastActivityAt: '2026-09-25T04:00:00.000Z',
  resolvedAt: null, escalatedAt: null, unread: true,
  student: { id: 's1', name: 'Aarav Mehta', className: '7 B' },
  assignedTeacher: { id: 't1', name: 'Mohammed Irfan Qureshi' },
  raisedBy: { name: 'Priya Mehta', role: 'PARENT' },
  commentCount: 1, ...over,
});

const detail = (over: Partial<ConcernDetail> = {}): ConcernDetail => ({
  ...row(), body: 'The bus reached the stop 25 minutes late twice this week.',
  attachments: [], canReopen: false,
  comments: [
    { id: 'm1', body: 'Sorry about this — asking the transport desk.', createdAt: '2026-09-25T06:00:00.000Z', visibleToFamily: true, statusFrom: null, statusTo: null, author: { name: 'Mohammed Irfan Qureshi', role: 'TEACHER' } },
    { id: 'm2', body: 'Driver changed without telling the office.', createdAt: '2026-09-25T06:30:00.000Z', visibleToFamily: false, statusFrom: null, statusTo: null, author: { name: 'Srikant Misra', role: 'ADMIN' } },
  ],
  ...over,
});

function api(handlers: Record<string, unknown>, post?: (p: string, b?: unknown) => unknown): ApiStub {
  return {
    get: vi.fn(async (p: string) => {
      const key = Object.keys(handlers).find((k) => p.startsWith(k));
      if (!key) throw new Error(`no stub for ${p}`);
      return handlers[key];
    }),
    post: vi.fn(async (p: string, b?: unknown) => (post ? post(p, b) : detail())),
    put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('the office’s Complaint Box', () => {
  it('leads with unread, says who each one went to, and opens the thread in a drawer — not under the list', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/manage/concerns/counts': COUNTS,
      '/manage/concerns/c1': detail(),
      '/manage/concerns': [row(), row({ id: 'c2', audience: 'OFFICE', assignedTeacher: null, title: 'Water cooler on the 2nd floor', unread: false, status: 'RESOLVED' })],
    }));
    const { container } = renderWithProviders(<ConcernsPage />);

    // The numbers, with the waiting families in amber.
    const unread = await screen.findByRole('link', { name: /Unread/ }).catch(() => null);
    const unreadTile = unread ?? screen.getAllByText('Unread').map((el) => el.closest('.sk-kpi')).find(Boolean)!;
    expect(unreadTile).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByText('Resolved this month').closest('.sk-kpi')).toHaveTextContent('usually in 1.6 days');
    expect(screen.getByText('Most raised').closest('.sk-kpi')).toHaveTextContent('School bus');

    // Each row says WHO it went to — the whole point of the family's choice.
    const rows = [screen.getByTestId('concern-c1'), screen.getByTestId('concern-c2')];
    expect(rows[0]).toHaveTextContent('to Mohammed Irfan Qureshi');
    expect(rows[1]).toHaveTextContent('to the office');
    expect(within(rows[0]).getByLabelText('unread')).toBeInTheDocument();

    // The thread opens in an overlay OUTSIDE the page tree (the kit's rule).
    await user.click(rows[0]);
    const dialog = await screen.findByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(within(dialog).getByText('Bus late twice this week')).toBeInTheDocument();
  });

  it('shows the school its own private note as private, and offers the moves', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/manage/concerns/counts': COUNTS, '/manage/concerns/c1': detail(), '/manage/concerns': [row()],
    }));
    renderWithProviders(<ConcernsPage />);
    await user.click(await screen.findByTestId('concern-c1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/only the school sees this/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Mark resolved' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Looking into it' })).toBeInTheDocument();
    // The office cannot send anything to a teacher — that door is the teacher's.
    expect(within(dialog).queryByRole('button', { name: 'Send to the office' })).toBeNull();
  });

  it('a reply can be kept between the school and nobody else', async () => {
    const user = userEvent.setup({ delay: null });
    const post = vi.fn(async () => detail());
    const stub = api({ '/manage/concerns/counts': COUNTS, '/manage/concerns/c1': detail(), '/manage/concerns': [row()] });
    stub.post = post as ApiStub['post'];
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<ConcernsPage />);
    await user.click(await screen.findByTestId('concern-c1'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Transport desk says the driver is back.');
    await user.click(within(dialog).getByRole('checkbox', { name: /Keep this between us/ }));
    await user.click(within(dialog).getByRole('button', { name: /Add note/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/manage/concerns/c1/comment', expect.objectContaining({ visibleToFamily: false })));
  });
});

describe('the class teacher’s Complaint Box', () => {
  it('reads its own route — never the office’s — and can send one up', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api({ '/teacher/concerns/counts': COUNTS, '/teacher/concerns/c1': detail(), '/teacher/concerns': [row()] });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<TeacherConcernsPage />);
    await screen.findByRole('heading', { name: 'Complaint Box' });
    expect((stub.get as ReturnType<typeof vi.fn>).mock.calls.flat().every((p) => String(p).startsWith('/teacher/concerns'))).toBe(true);

    await user.click(await screen.findByTestId('t-concern-c1'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Send to the office' }));
    await waitFor(() => expect(stub.post).toHaveBeenCalledWith('/teacher/concerns/c1/escalate', {}));
  });
});

describe('the family’s Complaint Box', () => {
  it('offers the class teacher BY NAME, and only when the class has one', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/me/profile': { className: '7-B', classTeacherName: 'Mohammed Irfan Qureshi' },
      '/me/concerns': [row({ unread: false })],
    }));
    renderWithProviders(<PortalConcernsPage />);
    await user.click(await screen.findByRole('button', { name: /Raise a concern/ }));
    const group = screen.getByRole('group', { name: 'Who should see this' });
    expect(within(group).getByRole('button', { name: /Class teacher · Mohammed Irfan Qureshi/ })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'School office' })).toBeInTheDocument();
  });

  it('does not offer a route that goes nowhere when the class has no class teacher', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/me/profile': { className: '7-B', classTeacherName: null },
      '/me/concerns': [],
    }));
    renderWithProviders(<PortalConcernsPage />);
    await user.click(await screen.findByRole('button', { name: /Raise a concern/ }));
    const group = screen.getByRole('group', { name: 'Who should see this' });
    expect(within(group).getAllByRole('button')).toHaveLength(1);
    expect(within(group).getByRole('button', { name: 'School office' })).toBeInTheDocument();
  });

  it('sends what the family chose, and the button never says “complain”', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api({ '/me/profile': { className: '7-B', classTeacherName: 'Mohammed Irfan Qureshi' }, '/me/concerns': [] });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<PortalConcernsPage />);
    const open = await screen.findByRole('button', { name: /Raise a concern/ });
    expect(open.textContent?.toLowerCase()).not.toContain('complain');
    await user.click(open);
    await user.click(screen.getByRole('button', { name: /Class teacher/ }));
    await user.type(screen.getByLabelText('In one line'), 'Bus late twice this week');
    await user.type(screen.getByLabelText('What happened'), 'Twenty-five minutes late, twice, with no message.');
    await user.click(screen.getByRole('button', { name: 'Send it' }));
    await waitFor(() => expect(stub.post).toHaveBeenCalledWith('/me/concerns', expect.objectContaining({
      audience: 'CLASS_TEACHER', title: 'Bus late twice this week',
    })));
  });

  it('never shows the family a note the school kept to itself', async () => {
    const user = userEvent.setup({ delay: null });
    // The API filters it; the screen must not depend on that being visible here.
    const familyDetail = detail({ comments: [detail().comments[0]] });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/me/profile': { className: '7-B', classTeacherName: null },
      '/me/concerns/c1': familyDetail,
      '/me/concerns': [row({ unread: false })],
    }));
    renderWithProviders(<PortalConcernsPage />);
    await user.click(await screen.findByTestId('my-concern-c1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/asking the transport desk/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Driver changed without telling/)).toBeNull();
    expect(within(dialog).queryByText(/only the school sees this/)).toBeNull();
    // A family never gets the school's moves.
    expect(within(dialog).queryByRole('button', { name: 'Mark resolved' })).toBeNull();
  });

  it('offers Reopen only while the window is open', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/me/profile': { className: '7-B', classTeacherName: null },
      '/me/concerns/c1': detail({ status: 'RESOLVED', canReopen: true, comments: [] }),
      '/me/concerns': [row({ status: 'RESOLVED', unread: false })],
    }));
    renderWithProviders(<PortalConcernsPage />);
    await user.click(await screen.findByTestId('my-concern-c1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /Reopen/ })).toBeInTheDocument();
  });

  it('says a closed one is closed, instead of a box that does nothing', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      '/me/profile': { className: '7-B', classTeacherName: null },
      '/me/concerns/c1': detail({ status: 'RESOLVED', canReopen: false, comments: [] }),
      '/me/concerns': [row({ status: 'RESOLVED', unread: false })],
    }));
    renderWithProviders(<PortalConcernsPage />);
    await user.click(await screen.findByTestId('my-concern-c1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/This one is closed/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });
});
