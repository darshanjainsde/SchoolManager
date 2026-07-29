import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClassDayStatus } from '@skoolos/types';
import { LockedDay } from './LockedDay';

function status(overrides: Partial<ClassDayStatus> = {}): ClassDayStatus {
  return {
    classSectionId: 'sec-1',
    name: '8-A',
    total: 28,
    present: 26,
    taken: true,
    markedBy: 'Anita Rao',
    markedAt: '2026-07-20T03:00:00.000Z',
    ...overrides,
  };
}

describe('LockedDay', () => {
  it('shows the read-only counts when status is given', () => {
    render(
      <LockedDay
        className="8-A"
        date="2026-07-20"
        status={status()}
        requestPending={false}
        isSubmitting={false}
        onRequestChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/26 of 28 present/)).toBeInTheDocument();
    expect(screen.getByText(/Anita Rao/)).toBeInTheDocument();
  });

  it('renders an explicit "no record for that day" state when status is null', () => {
    render(
      <LockedDay
        className="8-A"
        date="2026-07-20"
        status={null}
        requestPending={false}
        isSubmitting={false}
        onRequestChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/no attendance was recorded/i)).toBeInTheDocument();
  });

  it('submitting a reason calls onRequestChange with the trimmed text', async () => {
    const user = userEvent.setup();
    const onRequestChange = vi.fn();
    render(
      <LockedDay
        className="8-A"
        date="2026-07-20"
        status={status()}
        requestPending={false}
        isSubmitting={false}
        onRequestChange={onRequestChange}
      />,
    );
    await user.type(screen.getByLabelText('Reason for reopening'), '  Late enrolment correction  ');
    await user.click(screen.getByRole('button', { name: /request a change/i }));
    expect(onRequestChange).toHaveBeenCalledWith('Late enrolment correction');
  });

  it('does not call onRequestChange for a whitespace-only reason', async () => {
    const user = userEvent.setup();
    const onRequestChange = vi.fn();
    render(
      <LockedDay
        className="8-A"
        date="2026-07-20"
        status={status()}
        requestPending={false}
        isSubmitting={false}
        onRequestChange={onRequestChange}
      />,
    );
    await user.type(screen.getByLabelText('Reason for reopening'), '   ');
    await user.click(screen.getByRole('button', { name: /request a change/i }));
    expect(onRequestChange).not.toHaveBeenCalled();
  });

  it('shows the already-requested state and no form when requestPending', () => {
    render(
      <LockedDay
        className="8-A"
        date="2026-07-20"
        status={status()}
        requestPending
        isSubmitting={false}
        onRequestChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/waiting on your admin/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reason for reopening')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request a change/i })).not.toBeInTheDocument();
  });
});
