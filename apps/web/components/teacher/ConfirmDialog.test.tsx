import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Mirrors the requests-queue page (`app/teacher/requests/page.tsx`): a row
 * trigger button that's disabled while its own mutation is pending, plus a
 * `ConfirmDialog` that stays mounted for the lifetime of that mutation and is
 * handed fresh `onConfirm`/`onCancel` closures on every render (exactly what
 * `() => cancel.mutate(id)` / `() => setConfirmCancelId(null)` are — new
 * identities every time the page re-renders, never memoized).
 */
function Harness({
  open,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <button type="button" disabled={pending}>
        Cancel leave
      </button>
      {open && (
        <ConfirmDialog
          titleId="cancel-leave-title"
          title="Cancel this leave?"
          isPending={pending}
          confirmLabel="Yes, cancel leave"
          pendingLabel="Cancelling…"
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          <p>Your classes and attendance for the cancelled dates will be restored.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

describe('ConfirmDialog', () => {
  describe('focus survives a pending mutation while the dialog stays mounted', () => {
    it('restores focus to the trigger once the mutation settles, even though isPending flips true mid-mount with fresh onConfirm/onCancel identities', async () => {
      const user = userEvent.setup();

      // 1. Row trigger exists before the dialog opens; focus it the way a
      // real click would, so ConfirmDialog's mount effect captures it as
      // `previouslyFocused`.
      const { rerender } = render(
        <Harness open={false} pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
      );
      await user.click(screen.getByRole('button', { name: 'Cancel leave' }));
      const trigger = screen.getByRole('button', { name: 'Cancel leave' });
      expect(document.activeElement).toBe(trigger);

      // 2. Dialog opens (mirrors setConfirmCancelId(id)). Fresh closures,
      // same as the page passing new inline lambdas on every render.
      const onConfirmA = vi.fn();
      const onCancelA = vi.fn();
      rerender(<Harness open pending={false} onConfirm={onConfirmA} onCancel={onCancelA} />);

      // 3. User clicks Confirm inside the dialog — this is the click that
      // fires `cancel.mutate(id)` in the real page.
      await user.click(screen.getByRole('button', { name: /yes, cancel leave/i }));

      // 4. The mutation's setState flips isPending to true. In the real page
      // this is a *re-render*, not a remount, and it hands the dialog
      // brand-new onConfirm/onCancel closures — exactly like this rerender
      // with fresh spies. The row trigger is disabled in the same commit
      // (cancellingId now matches this row).
      const onConfirmB = vi.fn();
      const onCancelB = vi.fn();
      rerender(<Harness open pending onConfirm={onConfirmB} onCancel={onCancelB} />);

      // 5. Mutation settles (onSuccess/onError both do
      // `setConfirmCancelId(null)` in the real page, which unmounts the
      // dialog and re-enables the trigger).
      rerender(<Harness open={false} pending={false} onConfirm={onConfirmB} onCancel={onCancelB} />);

      // Before the fix this landed on `document.body` — the dependency
      // array `[onCancel]` made the trap effect tear down and re-arm on
      // every one of these renders, re-capturing `previouslyFocused` from a
      // mid-mutation snapshot instead of the real trigger. Reading
      // `onCancel` through a ref keeps the effect mounted exactly once, so
      // it restores focus to the trigger that actually opened the dialog.
      expect(document.activeElement).toBe(trigger);
    });
  });

  describe('Tab cycling', () => {
    it('wraps focus within the dialog and cannot escape to the page behind it', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <button type="button">Page button before</button>
          <ConfirmDialog
            titleId="t"
            title="Title"
            isPending={false}
            confirmLabel="Confirm"
            pendingLabel="Confirming…"
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          >
            <p>Body</p>
          </ConfirmDialog>
          <button type="button">Page button after</button>
        </div>,
      );

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' });

      // Mount focuses the first focusable in the panel (Cancel).
      expect(document.activeElement).toBe(cancelBtn);

      // Tab forward from the last item wraps to the first — never escapes
      // to "Page button after".
      await user.tab();
      expect(document.activeElement).toBe(confirmBtn);
      await user.tab();
      expect(document.activeElement).toBe(cancelBtn);

      // Shift+Tab from the first item wraps to the last — never escapes to
      // "Page button before".
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(confirmBtn);
    });
  });

  describe('focus restore on close', () => {
    it('returns focus to the element that opened it when Cancel is clicked', async () => {
      const user = userEvent.setup();

      function RestoreHarness() {
        const [open, setOpen] = useState(true);
        return (
          <div>
            <button type="button">Elsewhere</button>
            {open && (
              <ConfirmDialog
                titleId="t"
                title="Title"
                isPending={false}
                confirmLabel="Confirm"
                pendingLabel="Confirming…"
                onConfirm={vi.fn()}
                onCancel={() => setOpen(false)}
              >
                <p>Body</p>
              </ConfirmDialog>
            )}
          </div>
        );
      }

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.textContent = 'Open dialog';
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      render(<RestoreHarness />);
      // The dialog's own mount effect moves focus into the panel.
      expect(document.activeElement).not.toBe(trigger);

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(document.activeElement).toBe(trigger);
      document.body.removeChild(trigger);
    });

    it('returns focus to the element that opened it when Escape is pressed', async () => {
      const user = userEvent.setup();

      function RestoreHarness() {
        const [open, setOpen] = useState(true);
        return (
          <div>
            <button type="button">Elsewhere</button>
            {open && (
              <ConfirmDialog
                titleId="t"
                title="Title"
                isPending={false}
                confirmLabel="Confirm"
                pendingLabel="Confirming…"
                onConfirm={vi.fn()}
                onCancel={() => setOpen(false)}
              >
                <p>Body</p>
              </ConfirmDialog>
            )}
          </div>
        );
      }

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.textContent = 'Open dialog';
      document.body.appendChild(trigger);
      trigger.focus();

      render(<RestoreHarness />);
      await user.keyboard('{Escape}');

      expect(document.activeElement).toBe(trigger);
      document.body.removeChild(trigger);
    });
  });
});
