import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryTx } from '@library/db';
import {
  resolveReplacementPrice,
  type ReplacementPriceSource,
} from '../../../common/replacement-price';
import { assertBranchInScope } from '../../../common/guards/assert-branch-in-scope';
import type { ReportLostDto } from './dto';
import { computeFine } from './policy';
import { loadPolicy } from './policy-loader';

export interface ReportLostResult {
  lostReportId: string;
  /** The frozen late charge, or null when fines are off for this member type. */
  frozenLateAmount: number | null;
  /** null when nothing resolved — a legitimate, visible "unpriced" outcome. */
  replacementAmount: number | null;
  priceSource: ReplacementPriceSource;
  /** The two fines raised. Either may be null; see the flow doc below. */
  lateFineId: string | null;
  replacementFineId: string | null;
}

/**
 * Prisma's interactive-transaction default is 5000ms. This flow is ~12
 * statements over a pooler — the same shape as `returnBook`, which the spec's
 * known-debt list already flags as tight — and every one of them has to land or
 * none of them may. An explicit budget makes an overrun a clear timeout rather
 * than a silent 5s cutoff halfway through retiring a book.
 */
export const LOST_TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 };

@Injectable()
export class LostService {
  /**
   * Report a book lost, from the counter. Five things happen, and they happen
   * together or not at all.
   *
   *   1. CLOSE THE ISSUE (`returnedAt = now`, `status = LOST`). First,
   *      deliberately, because this is the step that STOPS THE MONEY: the late
   *      charge is derived at read time from rows where `returnedAt IS NULL`
   *      (see `overdueIssuesQuery` and `dayReport`), so setting it makes every
   *      existing read stop billing at once. The tempting alternative — leave
   *      it null and add `AND status = 'ACTIVE'` to each of those queries — is
   *      trap 9 applied to money: one query missed anywhere in the service, now
   *      or in five years, keeps billing the child who owned up.
   *   2. FREEZE the accrued late charge as an `OVERDUE` fine. This converts a
   *      number that was being derived into a number that is stored, which is
   *      the whole incentive: owning up stops the clock.
   *   3. RETIRE THE COPY (`status = LOST`). Nothing else — availability is
   *      counted, never stored, so the shelf count falls out of this by itself.
   *   4. RAISE THE REPLACEMENT CHARGE, with its source snapshotted onto the
   *      fine. If nothing resolves, NO fine is created: a ₹0 fine would read as
   *      "nothing owed" to every total and to P5's No Dues certificate, and the
   *      honest state is "we do not know yet".
   *   5. RECORD THE REPORT + audit entry, which is what retires the number in
   *      the register and what the lost-books panel reads.
   *
   * Fines respect `LibrarySettings.chargeStudentFines` exactly as `returnBook`
   * does — a school with fines off gets steps 1, 3 and 5 and no money at all.
   */
  async reportLost(
    tx: LibraryTx,
    orgId: string,
    dto: ReportLostDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<ReportLostResult> {
    const copy = await tx.copy.findUnique({
      where: { orgId_accessionNumber: { orgId, accessionNumber: dto.accessionNumber } },
      include: { title: { select: { replacementPrice: true } } },
    });
    if (!copy) throw new NotFoundException('Copy not found');

    const issue = await tx.issue.findFirst({ where: { copyId: copy.id, returnedAt: null } });
    if (!issue) throw new NotFoundException('No active issue for this copy');
    // Checked against the ISSUE's branch, not the copy's — the issue row is the
    // one this action mutates, the same call `returnBook` makes.
    assertBranchInScope(issue.branchId, allowedBranches);

    const member = await tx.member.findUnique({ where: { id: issue.memberId } });
    if (!member) throw new NotFoundException('Member not found');

    const policy = await loadPolicy(tx, orgId, member.memberType, issue.branchId);
    const { days, amount: lateAmount } = computeFine(policy, issue.dueAt, now);

    const settings = await tx.librarySettings.findUnique({
      where: { orgId },
      select: { chargeStudentFines: true },
    });
    const finesAllowed =
      member.memberType !== 'STUDENT' || (settings?.chargeStudentFines ?? false);

    // ---- 1. close the issue: this is what stops the late charge growing
    await tx.issue.update({
      where: { id: issue.id },
      data: { returnedAt: now, returnedByUserId: actorUserId, status: 'LOST' },
    });

    // ---- 2. freeze what had accrued
    let lateFineId: string | null = null;
    const frozenLateAmount = finesAllowed && lateAmount > 0 ? lateAmount : null;
    if (frozenLateAmount !== null) {
      const lateFine = await tx.fine.create({
        data: {
          orgId,
          memberId: member.id,
          issueId: issue.id,
          kind: 'OVERDUE',
          status: 'OPEN',
          amount: new Prisma.Decimal(frozenLateAmount),
          reason: `${days} day(s) late — frozen when reported lost`,
        },
      });
      lateFineId = lateFine.id;
    }

    // ---- 3. retire the copy from circulation
    await tx.copy.update({ where: { id: copy.id }, data: { status: 'LOST' } });

    // ---- 4. what a replacement costs, and where that number came from
    //
    // `typed` wins when the librarian entered one at the counter, which is the
    // only input with a human looking at the actual book. Decimals are
    // converted to plain numbers before reaching the pure resolver, matching
    // what `policy-loader.ts` already does for every other money column.
    const resolved = resolveReplacementPrice({
      typed: dto.replacementPrice,
      titlePrice: copy.title.replacementPrice?.toNumber() ?? null,
      copyAcquisitionCost: copy.acquisitionCost?.toNumber() ?? null,
    });

    let replacementFineId: string | null = null;
    // An UNPRICED loss raises no charge at all — see the method doc. Note this
    // is `!== null`, not truthiness: ₹0 is a real, deliberate price (a book
    // written off as out of print) and must still produce a fine.
    if (resolved.amount !== null && finesAllowed && resolved.source !== 'UNPRICED') {
      const replacementFine = await tx.fine.create({
        data: {
          orgId,
          memberId: member.id,
          issueId: issue.id,
          kind: 'LOST',
          status: 'OPEN',
          amount: new Prisma.Decimal(resolved.amount),
          reason: `Replacement for ${copy.accessionNumber}`,
          amountSource: resolved.source,
          // Only a TYPED amount names an author; the database CHECK
          // `Fine_amount_typed_has_author` enforces the same rule independently.
          amountSetByUserId: resolved.source === 'TYPED' ? actorUserId : null,
        },
      });
      replacementFineId = replacementFine.id;
    }

    // ---- 5. the report: what retires the number, and what every later
    // settlement hangs off. Created already CONFIRMED because a librarian is
    // standing at the counter having the conversation — the confirm step exists
    // for a child tapping a button with no adult in the loop, not for this.
    const report = await tx.lostReport.create({
      data: {
        orgId,
        copyId: copy.id,
        branchId: issue.branchId,
        memberId: member.id,
        issueId: issue.id,
        reportedByUserId: actorUserId,
        selfReported: false,
        reportedAt: now,
        status: 'CONFIRMED',
        confirmedAt: now,
        confirmedByUserId: actorUserId,
        frozenLateAmount:
          frozenLateAmount === null ? null : new Prisma.Decimal(frozenLateAmount),
        replacementAmount:
          resolved.amount === null ? null : new Prisma.Decimal(resolved.amount),
        // The CHECK `LostReport_price_has_source` ties these two together, so
        // the null-ness of one must always match the other.
        priceSource: resolved.source === 'UNPRICED' ? null : resolved.source,
      },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.lost',
        entity: 'LostReport',
        entityId: report.id,
        after: {
          accessionNumber: copy.accessionNumber,
          copyId: copy.id,
          memberId: member.id,
          issueId: issue.id,
          overdueDays: days,
          frozenLateAmount,
          replacementAmount: resolved.amount,
          priceSource: resolved.source,
        },
      },
    });

    return {
      lostReportId: report.id,
      frozenLateAmount,
      replacementAmount: resolved.amount,
      priceSource: resolved.source,
      lateFineId,
      replacementFineId,
    };
  }
}
