import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClassDayStatus } from '@skoolos/types';
import { RetakeDialog } from './RetakeDialog';

function status(overrides: Partial<ClassDayStatus> = {}): ClassDayStatus {
  return {
    classSectionId: 'sec-1',
    name: '8-A',
    total: 28,
    present: 27,
    taken: true,
    markedBy: 'Anita Rao',
    markedAt: '2026-07-29T03:00:00.000Z',
    ...overrides,
  };
}

describe('RetakeDialog', () => {
  it('names the teacher who marked it and the present/total counts', () => {
    render(
      <RetakeDialog
        className="8-A"
        status={status()}
        isPending={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Taken by Anita Rao/)).toBeInTheDocument();
    expect(screen.getByText(/27 of 28 present/)).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is pressed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RetakeDialog
        className="8-A"
        status={status()}
        isPending={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /re-take attendance/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is pressed', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RetakeDialog
        className="8-A"
        status={status()}
        isPending={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RetakeDialog
        className="8-A"
        status={status()}
        isPending={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders a sensible fallback instead of "Taken by null" when markedBy is null', () => {
    render(
      <RetakeDialog
        className="8-A"
        status={status({ markedBy: null })}
        isPending={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Already taken for this class today/i)).toBeInTheDocument();
  });

  it('disables both actions while isPending, so a double-click cannot fire two saves', () => {
    render(
      <RetakeDialog
        className="8-A"
        status={status()}
        isPending
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /retaking/i })).toBeDisabled();
  });
});
