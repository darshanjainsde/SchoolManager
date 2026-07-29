import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestList, type RequestItem } from './RequestList';

function leaveItem(overrides: Partial<Extract<RequestItem, { kind: 'leave' }>> = {}): RequestItem {
  return {
    kind: 'leave',
    id: 'leave-1',
    title: 'Sick leave',
    detail: '1 Aug 2026 – 3 Aug 2026',
    reason: 'Fever',
    status: 'PENDING',
    createdAt: '2026-07-29T03:00:00.000Z',
    cancellable: true,
    ...overrides,
  };
}

function registerItem(overrides: Partial<Extract<RequestItem, { kind: 'register' }>> = {}): RequestItem {
  return {
    kind: 'register',
    id: 'reg-1',
    title: '8-A',
    detail: '20 Jul 2026',
    reason: 'Late enrolment correction',
    status: 'PENDING',
    createdAt: '2026-07-28T03:00:00.000Z',
    expiresAt: null,
    ...overrides,
  };
}

describe('RequestList', () => {
  it('renders both kinds in one list, newest first', () => {
    // Given already in newest-first order (the page owns sorting) — a bug
    // that stacked leave rows and register rows into two separate sections
    // would still put both leave items first regardless of this order, so
    // this assertion only holds if it's genuinely one interleaved list.
    const items: RequestItem[] = [
      leaveItem({ id: 'l1', title: 'Sick leave', createdAt: '2026-07-29T10:00:00.000Z' }),
      registerItem({ id: 'r1', title: '8-A', createdAt: '2026-07-28T10:00:00.000Z' }),
      leaveItem({ id: 'l2', title: 'Casual leave', createdAt: '2026-07-27T10:00:00.000Z' }),
    ];
    render(<RequestList items={items} onCancelLeave={vi.fn()} cancellingId={null} />);

    const rows = document.querySelectorAll('.sk-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Sick leave');
    expect(rows[1]).toHaveTextContent('8-A');
    expect(rows[2]).toHaveTextContent('Casual leave');
  });

  it('a leave row shows its date range and status pill', () => {
    const items = [leaveItem({ detail: '1 Aug 2026 – 3 Aug 2026', status: 'APPROVED' })];
    render(<RequestList items={items} onCancelLeave={vi.fn()} cancellingId={null} />);

    const row = screen.getByText(/1 Aug 2026 – 3 Aug 2026/).closest('.sk-row') as HTMLElement;
    expect(within(row).getByText('Approved')).toBeInTheDocument();
  });

  it('a register-change row shows the class and the date being corrected', () => {
    const items = [registerItem({ title: '8-A', detail: '20 Jul 2026' })];
    render(<RequestList items={items} onCancelLeave={vi.fn()} cancellingId={null} />);

    expect(screen.getByText('8-A')).toBeInTheDocument();
    expect(screen.getByText(/20 Jul 2026/)).toBeInTheDocument();
  });

  it('an APPROVED register change with a future expiresAt shows the deadline', () => {
    const future = new Date(Date.now() + 24 * 3600_000).toISOString();
    const items = [registerItem({ status: 'APPROVED', expiresAt: future })];
    render(<RequestList items={items} onCancelLeave={vi.fn()} cancellingId={null} />);

    expect(screen.getByText(/Expires/)).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('an APPROVED register change whose expiresAt is in the past reads as expired, not open', () => {
    const past = new Date(Date.now() - 24 * 3600_000).toISOString();
    const items = [registerItem({ status: 'APPROVED', expiresAt: past })];
    render(<RequestList items={items} onCancelLeave={vi.fn()} cancellingId={null} />);

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    // No deadline is shown once it has already passed — there is nothing left to count down to.
    expect(screen.queryByText(/Expires/)).not.toBeInTheDocument();
  });

  it('a register change with expiresAt: null does not render "expires null" or crash', () => {
    const items = [registerItem({ status: 'REJECTED', expiresAt: null })];
    expect(() =>
      render(<RequestList items={items} onCancelLeave={vi.fn()} cancellingId={null} />),
    ).not.toThrow();

    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByText(/expires null/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Expires/)).not.toBeInTheDocument();
  });

  it("cancel calls onCancelLeave with the id, and only leave rows offer it", async () => {
    const user = userEvent.setup();
    const onCancelLeave = vi.fn();
    const items = [leaveItem({ id: 'l1', status: 'PENDING' }), registerItem({ id: 'r1' })];
    render(<RequestList items={items} onCancelLeave={onCancelLeave} cancellingId={null} />);

    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancelButtons).toHaveLength(1);

    await user.click(cancelButtons[0]);
    expect(onCancelLeave).toHaveBeenCalledWith('l1');
  });

  it("while cancellingId matches a row, that row's cancel is disabled", () => {
    const items = [leaveItem({ id: 'l1', status: 'PENDING' })];
    render(<RequestList items={items} onCancelLeave={vi.fn()} cancellingId="l1" />);

    expect(screen.getByRole('button', { name: /cancelling/i })).toBeDisabled();
  });

  it('an empty items array renders an explicit empty state', () => {
    render(<RequestList items={[]} onCancelLeave={vi.fn()} cancellingId={null} />);
    expect(screen.getByText('No requests yet.')).toBeInTheDocument();
  });
});
