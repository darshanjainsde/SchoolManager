import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * The leave desk's shared rules for /app/requests and /app/leave — the two
 * pages decide the same rows, so they must behave the same way.
 */

/** Shown in place of a decision on the viewer's own leave. The API refuses it (403 LEAVE_OWN_DECISION). */
export const OWN_LEAVE_HINT = 'Your own leave — another admin or the accounts officer decides it';

/** True only when both ids are known and match — an unknown id never hides the buttons. */
export function isOwnLeave(viewerUserId: string | null | undefined, personUserId: string | null | undefined): boolean {
  return !!viewerUserId && !!personUserId && viewerUserId === personUserId;
}

/**
 * A 409 on approve/reject means another desk decided this row first (the API's
 * message says who and when). The row is no longer pending, so the lists must
 * refetch or it sits there inviting a second, equally doomed tap.
 */
export function isDecidedElsewhere(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

/** Every leave-desk list a decision can move a row between. */
export function refreshLeaveDesk(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['a-leave-pending'] });
  void qc.invalidateQueries({ queryKey: ['a-leave-approved'] });
  void qc.invalidateQueries({ queryKey: ['a-leave-pending-context'] });
  void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
}
