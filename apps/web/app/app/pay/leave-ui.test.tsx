import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import LeavePanel from './leave-panel';
import LeaveSettings from './leave-settings';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(
  get: (path: string) => unknown,
  post?: (path: string, body?: unknown) => unknown,
  patch?: (path: string, body?: unknown) => unknown,
): ApiStub {
  return {
    get: vi.fn(async (p: string) => get(p)),
    post: vi.fn(async (p: string, b?: unknown) => (post ? post(p, b) : {})),
    patch: vi.fn(async (p: string, b?: unknown) => (patch ? patch(p, b) : {})),
    put: vi.fn(), del: vi.fn(),
  };
}

const PROPOSAL = {
  personKind: 'TEACHER' as const, personId: 't1', name: 'Priya Nair',
  lopDays: 2, lopWholeDays: 2, lopHalfDays: 0,
  reasons: ['Casual 14 of 12 used → 2 days over'],
  anchorApplicationId: 'l1', applied: false, clamped: false,
};

const MONTH = {
  basis: 'CALENDAR_DAY' as const, countHalfDays: true, daysInMonth: 30, workingDays: 26,
  proposals: [PROPOSAL], warnings: [], locked: false,
};

const TYPES = [
  { id: 'casual', name: 'Casual leave', builtin: 'CASUAL', isPaid: true, defaultAnnual: 12, defaultAnnualStaff: 8, neverDeduct: false, carryForwardCap: 0, isActive: true },
  { id: 'mat', name: 'Maternity', builtin: null, isPaid: true, defaultAnnual: 182, defaultAnnualStaff: 182, neverDeduct: true, carryForwardCap: 0, isActive: true },
  { id: 'gone', name: 'Retired type', builtin: null, isPaid: true, defaultAnnual: 5, defaultAnnualStaff: 5, neverDeduct: false, carryForwardCap: 0, isActive: false },
];

beforeEach(() => vi.mocked(useHost).mockReturnValue('school.sckools.com'));

describe('leave that reaches pay', () => {
  it('shows the arithmetic, not just the figure', async () => {
    // "₹2,600 deducted" is unanswerable; the sentence is arguable, which is
    // what a person needs when they think the school has it wrong.
    vi.mocked(useApi).mockReturnValue(mockApi(() => MONTH) as never);
    renderWithProviders(<LeavePanel year={2026} month={9} />);
    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
    expect(screen.getByText('Casual 14 of 12 used → 2 days over')).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
  });

  it('charges nobody until somebody is chosen', async () => {
    const post = vi.fn(async () => ({ applied: 1 }));
    vi.mocked(useApi).mockReturnValue(mockApi(() => MONTH, post) as never);
    renderWithProviders(<LeavePanel year={2026} month={9} />);

    const button = await screen.findByRole('button', { name: /choose who to charge/i });
    expect(button).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: /charge 2 unpaid days to Priya Nair/i }));
    await userEvent.click(screen.getByRole('button', { name: /charge 1 person/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/payroll/leave/apply', { year: 2026, month: 9, personIds: ['t1'] }));
  });

  it('draws nothing at all when nobody went over', async () => {
    // A card that says "nothing to do" is a card the reader has to read.
    vi.mocked(useApi).mockReturnValue(mockApi(() => ({ ...MONTH, proposals: [], warnings: [] })) as never);
    const { container } = renderWithProviders(<LeavePanel year={2026} month={9} />);
    await waitFor(() => expect(container.querySelector('.sk-card')).toBeNull());
  });

  it('still appears for a warning when there is nothing to charge', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(() => ({
      ...MONTH, proposals: [],
      warnings: ['Sam Kumar has leave still waiting on a decision — it is left out of this month.'],
    })) as never);
    renderWithProviders(<LeavePanel year={2026} month={9} />);
    expect(await screen.findByText(/still waiting on a decision/)).toBeInTheDocument();
  });

  it('separates what is already charged from what is not', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(() => ({
      ...MONTH, proposals: [{ ...PROPOSAL, applied: true }],
    })) as never);
    renderWithProviders(<LeavePanel year={2026} month={9} />);
    expect(await screen.findByText('already charged')).toBeInTheDocument();
    // Nothing to choose, so no chooser.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('refuses to charge a locked month, and says where the correction goes', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(() => ({ ...MONTH, locked: true })) as never);
    renderWithProviders(<LeavePanel year={2026} month={9} />);
    await userEvent.click(await screen.findByRole('checkbox'));
    expect(screen.getByRole('button', { name: /charge 1 person/i })).toBeDisabled();
    expect(screen.getByText(/belongs in the next month/i)).toBeInTheDocument();
  });

  it('names a whole-month deduction as what it is', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(() => ({
      ...MONTH, proposals: [{ ...PROPOSAL, lopDays: 30, clamped: true }],
    })) as never);
    renderWithProviders(<LeavePanel year={2026} month={9} />);
    expect(await screen.findByText('the whole month')).toBeInTheDocument();
  });

  it('writes a half day as a half, not as 2.5', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(() => ({
      ...MONTH, proposals: [{ ...PROPOSAL, lopDays: 2.5, lopWholeDays: 2, lopHalfDays: 1 }],
    })) as never);
    renderWithProviders(<LeavePanel year={2026} month={9} />);
    expect(await screen.findByText('2½ days')).toBeInTheDocument();
  });
});

describe('the leave settings', () => {
  const get = (p: string) => (p.startsWith('/manage/leave-policy/types') ? TYPES : { ...MONTH, proposals: [] });

  it('gives teachers and other staff their own number', async () => {
    // One column would have forced a teacher's quota onto a driver.
    vi.mocked(useApi).mockReturnValue(mockApi(get) as never);
    renderWithProviders(<LeaveSettings />);
    expect(await screen.findByLabelText(/Teachers — days of Casual leave/)).toHaveValue(12);
    expect(screen.getByLabelText(/Other staff — days of Casual leave/)).toHaveValue(8);
    // Each row names its own type, so one label never stands for six controls.
    expect(screen.getByLabelText(/Teachers — days of Maternity/)).toHaveValue(182);
  });

  it('saves a changed quota when the field is left', async () => {
    const patch = vi.fn(async () => ({}));
    vi.mocked(useApi).mockReturnValue(mockApi(get, undefined, patch) as never);
    renderWithProviders(<LeaveSettings />);

    const field = await screen.findByLabelText(/Other staff — days of Casual leave/);
    await userEvent.clear(field);
    await userEvent.type(field, '10');
    await userEvent.tab();

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/manage/leave-policy/types/casual', { defaultAnnualStaff: 10 }));
  });

  it('says plainly which type never costs pay', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(get) as never);
    renderWithProviders(<LeaveSettings />);
    expect(await screen.findByText('Never costs pay')).toBeInTheDocument();
  });

  it('leaves retired types out', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(get) as never);
    renderWithProviders(<LeaveSettings />);
    await screen.findByText('Casual leave');
    expect(screen.queryByText('Retired type')).toBeNull();
  });

  it('saves the one deduction rule for the whole school', async () => {
    const post = vi.fn(async () => ({ ok: true }));
    vi.mocked(useApi).mockReturnValue(mockApi(get, post) as never);
    renderWithProviders(<LeaveSettings />);

    await userEvent.selectOptions(await screen.findByLabelText('Days counted'), 'WORKING_DAY');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payroll/leave/policy', { basis: 'WORKING_DAY', countHalfDays: true }));
  });

  it('keeps the half-day rule when only the basis changes', async () => {
    // Both fields go on one POST, so sending the basis alone would silently
    // reset the half-day rule to whatever the DTO defaults to.
    const post = vi.fn(async () => ({ ok: true }));
    vi.mocked(useApi).mockReturnValue(mockApi(
      (p) => (p.startsWith('/manage/leave-policy/types') ? TYPES : { ...MONTH, proposals: [], countHalfDays: false }),
      post,
    ) as never);
    renderWithProviders(<LeaveSettings />);

    await userEvent.selectOptions(await screen.findByLabelText('Days counted'), 'WARN_ONLY');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payroll/leave/policy', { basis: 'WARN_ONLY', countHalfDays: false }));
  });
});
