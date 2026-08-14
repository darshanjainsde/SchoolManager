import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';

/**
 * Undo an issue that should never have happened.
 *
 * Moved here from `apps/library-api/src/modules/circulation/internal/
 * void.service.ts` when the librarian's counter inside Sckools needed it:
 * `apps/api` cannot import that app, and undo is a DAILY action — mistyping a
 * number issues the wrong book to the wrong child. `VoidService` is now a thin
 * delegate, so there is still exactly one implementation.
 *
 * WHY THIS IS IN THE FIRST VERSION. Mistyping a number at the counter issues
 * the wrong book, or issues to the wrong child, and it happens daily. Without a
 * reversal the librarian's only options are to leave a false loan standing
 * against a child, or to "return" a book that was never taken — which fabricates
 * a return in the day report and, once the due date passes, bills a family for a
 * book sitting on the shelf. A librarian who cannot correct her own mistake
 * stops trusting the software within a week, and then the register, the
 * availability count and the not-returned list are wrong forever. That is the
 * same failure mode as an unexplained ₹300 bill, arriving by a different door.
 *
 * WHY IT DELETES THE ROW RATHER THAN ADDING AN `IssueStatus.VOID`.
 * Both alternatives were measured against the code, not guessed:
 *
 *   - Keep the row with a VOID status and leave `returnedAt` NULL: the late
 *     charge is derived at read time from `returnedAt IS NULL` in 39 places,
 *     including the raw SQL in `fines.service.ts`. A voided issue would keep
 *     accruing money. Adding `AND status <> 'VOID'` to each of those is trap 9
 *     applied to money — the exact mistake P3's design notes call out.
 *   - Keep the row and set `returnedAt`: `fines.service.ts` counts a return as
 *     `returnedAt` inside the day, so a void would fabricate a return in the
 *     day report and the collections figures.
 *
 * A mistyped issue did not happen. The `AuditLog` row written here is the
 * history — it carries a full snapshot of the deleted issue plus the reason —
 * and it is the same place every other circulation act is recorded. Deleting
 * also means no shipped enum gains a value, which the P3 notes warn silently
 * changes every sum built on it.
 *
 * WHAT MAY BE VOIDED. Only an ACTIVE issue with no money or loss derived from
 * it. A returned issue is not a mistype (use the return flow); an issue with a
 * `Fine` or a `LostReport` is a money trail, and money is corrected by the
 * waive/settle routes that were built to leave an auditable reason. The
 * `LostReport.issueId` FK is `onDelete: Restrict`, so the database refuses that
 * case even if this check were removed — belt and braces, deliberately.
 *
 * NOT time-limited, deliberately. A mistake found on Thursday for Tuesday's
 * issue is still a mistake, and the alternative — a false loan standing against
 * a child because a window lapsed — is worse than the risk of a late
 * correction, which is fully audited anyway.
 */

export interface VoidIssueResult {
  issueId: string;
  copyId: string;
  accessionNumber: string;
  memberName: string;
  /** Restored so the shelf count is right again. */
  copyStatus: string;
  /** True when a reservation was put back on the shelf for the member who held it. */
  reservationRestored: boolean;
  /**
   * Set when this void also removed an automatic attendance mark, so the
   * librarian is TOLD rather than left to discover it. See the note below on
   * why removal is the safer default.
   */
  attendanceRemovedFor: string | null;
}

export async function voidIssue(
  tx: LibraryTx,
  orgId: string,
  issueId: string,
  reason: string,
  actorUserId: string | null,
): Promise<VoidIssueResult> {
  const issue = await tx.issue.findFirst({
    where: { id: issueId, orgId },
    include: {
      copy: { select: { id: true, accessionNumber: true, status: true, title: { select: { title: true } } } },
      member: { select: { id: true, firstName: true, lastName: true, code: true, classRef: true } },
    },
  });
  if (!issue) throw new NotFoundException('No such issue');

  if (issue.status !== 'ACTIVE' || issue.returnedAt !== null) {
    // A returned or lost issue is not a mistype. Saying so plainly beats a
    // generic 400 — the librarian needs to know WHICH flow to use instead.
    throw new BadRequestException(
      issue.status === 'LOST'
        ? 'This book was reported lost. Use the lost-book screen to correct that.'
        : 'This book has already been returned. Undo only applies to a book still out.',
    );
  }

  const [fineCount, lostCount] = await Promise.all([
    tx.fine.count({ where: { orgId, issueId } }),
    tx.lostReport.count({ where: { orgId, issueId } }),
  ]);
  if (fineCount > 0 || lostCount > 0) {
    throw new BadRequestException(
      'Money or a loss has already been recorded against this issue. Correct it on the fines or lost-book screen, where the reason is recorded.',
    );
  }

  // ── Put the copy back ────────────────────────────────────────────────
  // If this issue collected a reservation, the copy belongs back on the
  // reserved shelf for whoever was waiting — not in general circulation,
  // which would let someone else take a book that is still being held.
  const collected = await tx.reservation.findFirst({
    where: { orgId, readyCopyId: issue.copyId, status: 'COLLECTED' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });

  let reservationRestored = false;
  let copyStatus: string;
  if (collected) {
    await tx.reservation.update({ where: { id: collected.id }, data: { status: 'READY' } });
    await tx.copy.update({ where: { id: issue.copyId }, data: { status: 'RESERVED_SHELF' } });
    copyStatus = 'RESERVED_SHELF';
    reservationRestored = true;
  } else {
    await tx.copy.update({ where: { id: issue.copyId }, data: { status: 'AVAILABLE' } });
    copyStatus = 'AVAILABLE';
  }

  // ── Undo the attendance by-product ───────────────────────────────────
  // Issuing marks the member present automatically. If the MEMBER code was
  // the thing mistyped, a child who was never in the library is now marked
  // present — and §2.6 is explicit that a false positive on attendance is
  // far worse than a false negative. We cannot know which field was
  // mistyped, so the spec's own ranking decides it: remove the mark.
  //
  // Only automatic marks, and only when this member has no OTHER open issue
  // in the same visit — if they do, they were demonstrably there and the
  // mark stands on its own evidence.
  let attendanceRemovedFor: string | null = null;
  const otherIssues = await tx.issue.count({
    where: { orgId, memberId: issue.memberId, returnedAt: null, id: { not: issueId } },
  });
  if (otherIssues === 0) {
    const removed = await tx.$executeRaw`
      DELETE FROM "VisitAttendance" va
      USING "ClassVisit" v
      WHERE va."visitId" = v."id"
        AND va."orgId"   = ${orgId}::uuid
        AND va."memberId" = ${issue.memberId}::uuid
        AND va."auto"    = true
        AND v."closedAt" IS NULL
    `;
    if (removed > 0) {
      attendanceRemovedFor = `${issue.member.firstName} ${issue.member.lastName}`.trim();
    }
  }

  // ── Record it, THEN delete ───────────────────────────────────────────
  // `before` carries the whole issue, because after the next statement this
  // audit row is the only record that it ever existed.
  await tx.auditLog.create({
    data: {
      orgId,
      actorUserId,
      action: 'circulation.issue.void',
      entity: 'Issue',
      entityId: issue.id,
      before: {
        copyId: issue.copyId,
        accessionNumber: issue.copy.accessionNumber,
        title: issue.copy.title.title,
        memberId: issue.memberId,
        memberCode: issue.member.code,
        memberName: `${issue.member.firstName} ${issue.member.lastName}`.trim(),
        branchId: issue.branchId,
        issuedAt: issue.issuedAt.toISOString(),
        dueAt: issue.dueAt.toISOString(),
        renewCount: issue.renewCount,
        issuedByUserId: issue.issuedByUserId,
      },
      after: {
        reason,
        copyStatus,
        reservationRestored,
        attendanceRemoved: attendanceRemovedFor !== null,
      },
    },
  });

  await tx.issue.delete({ where: { id: issue.id } });

  return {
    issueId: issue.id,
    copyId: issue.copyId,
    accessionNumber: issue.copy.accessionNumber,
    memberName: `${issue.member.firstName} ${issue.member.lastName}`.trim(),
    copyStatus,
    reservationRestored,
    attendanceRemovedFor,
  };
}