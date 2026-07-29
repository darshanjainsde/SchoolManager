'use client';
import type { ClassDayStatus } from '@skoolos/types';
import { ConfirmDialog } from './ConfirmDialog';

export interface RetakeDialogProps {
  className: string;
  /** Carries markedBy, present, total for the class+date being retaken. */
  status: ClassDayStatus;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirms replacing an already-taken register. All of the dialog mechanics
 * (focus trap, Escape, focus restore) live in the shared `ConfirmDialog` —
 * this component only supplies the retake-specific title and body.
 */
export function RetakeDialog({
  className,
  status,
  isPending,
  onConfirm,
  onCancel,
}: RetakeDialogProps): React.JSX.Element {
  return (
    <ConfirmDialog
      titleId="retake-dialog-title"
      title={`Re-take attendance for ${className}?`}
      isPending={isPending}
      confirmLabel="Yes, re-take attendance"
      pendingLabel="Retaking…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        {status.markedBy ? `Taken by ${status.markedBy}` : 'Already taken for this class today'} —{' '}
        {status.present} of {status.total} present.
      </p>
      <p className="sk-muted">
        There is one register per class per day, so re-taking replaces it for every teacher of
        this class. The previous version is kept in the audit log.
      </p>
    </ConfirmDialog>
  );
}
