import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Overlay } from './kit';

function Host({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="Trap" onClose={onClose} footer={<button type="button">Save</button>}>
      <input aria-label="Phone" />
    </Overlay>
  );
}

describe('the overlay focus trap', () => {
  it('does not take focus back when the parent re-renders with a new onClose', async () => {
    const { rerender } = render(<Host onClose={() => {}} />);
    const phone = await screen.findByLabelText('Phone');
    phone.focus();
    expect(phone).toHaveFocus();

    // A dashboard refetch re-renders the dock, which hands down a new function.
    rerender(<Host onClose={() => {}} />);
    rerender(<Host onClose={() => {}} />);
    expect(phone).toHaveFocus();
  });

  it('moves focus into the dialog once it opens', async () => {
    render(<Host onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape calls the LATEST onClose, not the first one', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<Host onClose={first} />);
    await screen.findByRole('dialog');
    rerender(<Host onClose={latest} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('Tab wraps from the last control to the first, and Shift+Tab back — the trap is engaged', async () => {
    render(<Host onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(dialog.contains(close)).toBe(true);

    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();
  });
});
