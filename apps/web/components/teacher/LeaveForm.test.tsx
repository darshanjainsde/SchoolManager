import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeaveForm } from './LeaveForm';

describe('LeaveForm', () => {
  it('submitting calls onSubmit with the entered values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LeaveForm isSubmitting={false} onSubmit={onSubmit} />);

    await user.selectOptions(screen.getByLabelText('Type'), 'CASUAL');
    // `fireEvent.change` rather than `user.type` — a native `type="date"`
    // input parses its value from complete date parts, not individual
    // keystrokes, and userEvent's per-character typing doesn't reliably
    // drive it in jsdom.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-03' } });
    await user.type(screen.getByLabelText('Reason (optional)'), 'Family event');

    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'CASUAL',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      reason: 'Family event',
    });
  });

  it('an end date before the start date blocks submission and explains why', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LeaveForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } });

    expect(screen.getByText(/end date must be on or after the start date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a whitespace-only reason is sent as undefined, not "   "', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LeaveForm isSubmitting={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-03' } });
    await user.type(screen.getByLabelText('Reason (optional)'), '   ');

    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reason: undefined }));
    const call = onSubmit.mock.calls[0][0];
    expect(call.reason).toBeUndefined();
    expect(call).not.toHaveProperty('reason', '   ');
  });

  it('disables the submit button while isSubmitting, so a double-click cannot file two applications', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LeaveForm isSubmitting onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-03' } });

    const button = screen.getByRole('button', { name: 'Submitting…' });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
