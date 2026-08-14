import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryTx } from '@library/db';
import { loadPolicy } from './policy-loader';
import { computeFine } from '../policy';

/**
 * A child says they have lost a book.
 *
 * Moved here from `apps/library-api/.../lost.service.ts#selfReportLost` so the
 * Sckools student portal can offer it: `apps/api` cannot import that app, and
 * the button was deliberately held back until a librarian had a screen to act
 * on it — which the counter now is.
 *
 * WHAT THIS DOES NOT DO IS THE POINT. It creates NO `Fine`. The frozen late
 * charge lives on `LostReport` until a librarian CONFIRMS, because confirming
 * is the moment a human looks at the actual book and at the amount. A
 * nine-year-old tapping a button must never be the act that bills their family.
 *
 * It also returns NO rupee figure. The child is told the clock has stopped —
 * that is the entire reason owning up is safe — and the only party that tells
 * them what they owe is the library, afterwards.
 *
 * TWO IDS, and they are not interchangeable (the third place in this codebase
 * where this bites). `actorUserId` goes to `AuditLog.actorUserId`, which has no
 * foreign key, so any caller's own user id is valid and recording it is the
 * point. `libUserId` goes to `Issue.returnedByUserId` and
 * `LostReport.reportedByUserId`, which ARE foreign keys to `LibUser`. A Sckools
 * student has a `User` row and no `LibUser` row, so `apps/api` passes null;
 * `apps/library-api` lets it default and behaves exactly as before.
 */
export interface SelfReportLostResult {
  lostReportId: string;
  /** Whether a late charge was frozen. Never how much. */
  lateChargeFrozen: boolean;
}

/**
 * `lost_report_one_open_per_copy` is what actually serialises two people
 * reporting the same book; an unmapped P2002 surfaces with no HTTP status and
 * Nest renders it as a 500. The loser of that race is not a server fault.
 */
async function createLostReport(tx: LibraryTx, data: Prisma.LostReportUncheckedCreateInput) {
  try {
    return await tx.lostReport.create({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('This copy is already reported lost');
    }
    throw err;
  }
}

export async function selfReportLost(
  tx: LibraryTx,
  orgId: string,
  accessionNumber: string,
  /**
   * Resolved by the CALLER, not derived here. `library-api` reads it off the
   * signed-in `LibUser`; Sckools resolves it from `Member.externalRef`. Making
   * this a parameter is what lets one implementation serve both identities.
   */
  memberId: string,
  actorUserId: string,
  now: Date,
  libUserId: string | null = actorUserId,
): Promise<SelfReportLostResult> {
  const copy = await tx.copy.findUnique({
    where: { orgId_accessionNumber: { orgId, accessionNumber } },
  });
  if (!copy) throw new NotFoundException('Copy not found');

  // Scoped to THIS member's active issue: a child cannot report a book that is
  // not in their own hands, and the 404 is deliberately identical to the one
  // above so the route cannot be used to probe what other people are holding.
  const issue = await tx.issue.findFirst({
    where: { copyId: copy.id, memberId, returnedAt: null },
  });
  if (!issue) throw new NotFoundException('No active issue for this copy');

  const member = await tx.member.findUnique({ where: { id: memberId } });
  if (!member) throw new NotFoundException('Member not found');

  const policy = await loadPolicy(tx, orgId, member.memberType, issue.branchId);
  const { amount: lateAmount } = computeFine(policy, issue.dueAt, now);
  const settings = await tx.librarySettings.findUnique({
    where: { orgId },
    select: { chargeStudentFines: true },
  });
  const finesAllowed = member.memberType !== 'STUDENT' || (settings?.chargeStudentFines ?? false);
  const frozenLateAmount = finesAllowed && lateAmount > 0 ? lateAmount : null;

  // CLOSING THE ISSUE IS STEP ONE, because it is what stops the money: the late
  // charge is derived at read time from `returnedAt IS NULL`.
  await tx.issue.update({
    where: { id: issue.id },
    data: { returnedAt: now, returnedByUserId: libUserId, status: 'LOST' },
  });
  await tx.copy.update({ where: { id: copy.id }, data: { status: 'LOST' } });

  const report = await createLostReport(tx, {
    orgId,
    copyId: copy.id,
    branchId: issue.branchId,
    memberId,
    issueId: issue.id,
    reportedByUserId: libUserId,
    selfReported: true,
    reportedAt: now,
    // REPORTED, not CONFIRMED: no money exists yet.
    status: 'REPORTED',
    frozenLateAmount: frozenLateAmount === null ? null : new Prisma.Decimal(frozenLateAmount),
  });

  await tx.auditLog.create({
    data: {
      orgId,
      actorUserId,
      action: 'circulation.lost.self_report',
      entity: 'LostReport',
      entityId: report.id,
      after: { accessionNumber, copyId: copy.id, memberId, frozenLateAmount },
    },
  });

  return { lostReportId: report.id, lateChargeFrozen: frozenLateAmount !== null };
}
