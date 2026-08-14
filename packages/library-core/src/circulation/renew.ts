import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Issue, LibraryTx } from '@library/db';
import { assertBranchInScope } from '../branch-scope';
import { loadPolicy } from './policy-loader';
import { evaluateRenew, type RenewDenial } from '../policy';

/**
 * Structural stand-in for `apps/library-api`'s `RenewBookDto` — same reasoning
 * as `IssueBookInput` in `issues.ts`.
 */
export interface RenewBookInput {
  accessionNumber: string;
}

/** `RenewDenial` -> the HTTP exception a circulation-desk caller should see. All three are policy/state denials on the LOAN itself, not a copy-availability conflict — so 403 uniformly, same body shape as `issues.ts`'s `issueDenialToException`. */
function renewDenialToException(reason: RenewDenial): ForbiddenException {
  const message =
    reason === 'ALREADY_OVERDUE'
      ? 'This issue is already overdue and must be returned, not renewed'
      : reason === 'RENEW_LIMIT'
        ? 'This issue has reached its renewal limit'
        : 'Another member is waiting on this title — renewing would delay their turn';
  return new ForbiddenException({ reason, message });
}

export interface RenewResult {
  issue: Issue;
}

/**
 * One transaction: resolve the active issue for the scanned accessionNumber ->
 * load member/policy -> count PENDING reservations on the issue's title ->
 * `evaluateRenew` -> update `Issue.dueAt`/`renewCount`, write an
 * `AuditLog` row. Deliberately counts only `PENDING` reservations (not `READY`):
 * a READY reservation is already tied to a SPECIFIC other copy of this title
 * (`readyCopyId`), so renewing THIS issue doesn't delay that member's
 * fulfillment — only someone still waiting for ANY copy (PENDING) is
 * whose turn a renewal would push back, which is `evaluateRenew`'s own
 * `pendingReservationsOnTitle` parameter name and reasoning (policy.ts).
 */
export async function renew(
  tx: LibraryTx,
  orgId: string,
  dto: RenewBookInput,
  actorUserId: string,
  now: Date,
  allowedBranches: string[],
): Promise<RenewResult> {
  const copy = await tx.copy.findUnique({ where: { orgId_accessionNumber: { orgId, accessionNumber: dto.accessionNumber } } });
  if (!copy) throw new NotFoundException('Copy not found');

  const activeIssue = await tx.issue.findFirst({ where: { copyId: copy.id, returnedAt: null } });
  if (!activeIssue) throw new NotFoundException('No active issue for this copy');
  // Same reasoning as issues.ts's returnBook: checked against the
  // LOAN's own branch, the row this action actually mutates.
  assertBranchInScope(activeIssue.branchId, allowedBranches);

  // Same non-FK-lookup reasoning as issues.ts's returnBook: Issue.member
  // is onDelete Restrict, and activeIssue.memberId was read off an already
  // org-scoped row on this same tx, not supplied by the client.
  const member = await tx.member.findUnique({ where: { id: activeIssue.memberId } });
  if (!member) throw new NotFoundException('Member not found');

  const policy = await loadPolicy(tx, orgId, member.memberType, activeIssue.branchId);
  const pendingReservationsOnTitle = await tx.reservation.count({ where: { orgId, titleId: copy.titleId, status: 'PENDING' } });

  const decision = evaluateRenew(policy, activeIssue, pendingReservationsOnTitle, now);
  if (!decision.allowed) throw renewDenialToException(decision.reason);

  const updated = await tx.issue.update({
    where: { id: activeIssue.id },
    data: { dueAt: decision.newDueAt, renewCount: { increment: 1 } },
  });

  await tx.auditLog.create({
    data: {
      orgId,
      actorUserId,
      action: 'circulation.renew',
      entity: 'Issue',
      entityId: activeIssue.id,
      after: { copyId: copy.id, accessionNumber: dto.accessionNumber, memberId: member.id, newDueAt: decision.newDueAt.toISOString(), renewCount: updated.renewCount },
    },
  });

  return { issue: updated };
}
