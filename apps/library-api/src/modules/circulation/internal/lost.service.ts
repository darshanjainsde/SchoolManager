import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

  /**
   * A child reports their own book lost, from the app.
   *
   * Runs steps 1, 3 and 5 — the issue closes, the copy leaves circulation, the
   * report is recorded — and FREEZES the late figure onto the report. It
   * creates NO fines. That split is the whole design:
   *
   *   - The incentive has to work from the moment of the tap, or owning up is
   *     not cheaper than staying quiet. So the clock stops immediately and the
   *     accrued figure is captured immediately.
   *   - But a nine-year-old tapping a button must not create a bill to their
   *     parent with no adult in the loop. So the money waits for a librarian.
   *
   * There is deliberately no `FineStatus.PENDING` holding the amount instead:
   * adding a value to a shipped money enum would silently start counting an
   * unconfirmed tap as money owed in `listFines`, `dayReport`, the console's
   * owed tile and P4's `/me/dues`, unless every one of them were found and
   * filtered (trap 9).
   *
   * The member is resolved HERE, from the caller's own `LibUser.memberId`,
   * rather than accepted as a parameter. The controller has no way to hand in
   * someone else's id even by mistake, and there is no request-body field a
   * client could put one in — which is what makes "a child may only report a
   * book that is in their own hands" a property of the code rather than of
   * every future caller remembering.
   */
  async selfReportLost(
    tx: LibraryTx,
    orgId: string,
    accessionNumber: string,
    actorUserId: string,
    now: Date,
  ): Promise<{ lostReportId: string; frozenLateAmount: number | null }> {
    const actor = await tx.libUser.findUnique({
      where: { id: actorUserId },
      select: { memberId: true },
    });
    if (!actor?.memberId) {
      // A staff account with no member row has no books of its own to lose.
      throw new NotFoundException('No active issue for this copy');
    }
    const memberId = actor.memberId;

    const copy = await tx.copy.findUnique({
      where: { orgId_accessionNumber: { orgId, accessionNumber } },
    });
    if (!copy) throw new NotFoundException('Copy not found');

    // Scoped to THIS member's active issue: a child cannot report a book that
    // is not in their own hands, and the 404 is deliberately identical to the
    // one above so the route cannot be used to probe what other people hold.
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
    const finesAllowed =
      member.memberType !== 'STUDENT' || (settings?.chargeStudentFines ?? false);
    const frozenLateAmount = finesAllowed && lateAmount > 0 ? lateAmount : null;

    await tx.issue.update({
      where: { id: issue.id },
      data: { returnedAt: now, returnedByUserId: actorUserId, status: 'LOST' },
    });
    await tx.copy.update({ where: { id: copy.id }, data: { status: 'LOST' } });

    const report = await tx.lostReport.create({
      data: {
        orgId,
        copyId: copy.id,
        branchId: issue.branchId,
        memberId,
        issueId: issue.id,
        reportedByUserId: actorUserId,
        selfReported: true,
        reportedAt: now,
        // REPORTED, not CONFIRMED: no money exists yet.
        status: 'REPORTED',
        frozenLateAmount:
          frozenLateAmount === null ? null : new Prisma.Decimal(frozenLateAmount),
      },
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

    return { lostReportId: report.id, frozenLateAmount };
  }

  /**
   * A librarian confirms a self-reported loss. This is the moment the money
   * becomes real, and the only moment a human is looking at the actual book —
   * so it is also where the price may be typed.
   *
   * Both fines are created from the FROZEN figures, never recomputed. Days have
   * passed since the child tapped the button, and recomputing the late charge
   * here would quietly undo the freeze the whole incentive rests on.
   */
  async confirmLost(
    tx: LibraryTx,
    orgId: string,
    reportId: string,
    typedPrice: number | undefined,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<ReportLostResult> {
    const report = await tx.lostReport.findUnique({
      where: { id: reportId },
      include: { copy: { include: { title: { select: { replacementPrice: true } } } } },
    });
    if (!report) throw new NotFoundException('Lost report not found');
    assertBranchInScope(report.branchId, allowedBranches);
    if (report.status !== 'REPORTED') {
      throw new ConflictException(`Lost report is ${report.status}, not awaiting confirmation`);
    }
    if (!report.memberId || !report.issueId) {
      // Structurally impossible for a self-report (the CHECK constraints
      // guarantee it), but the types are nullable for stock-take losses.
      throw new ConflictException('This loss has no member to charge');
    }

    const member = await tx.member.findUnique({ where: { id: report.memberId } });
    if (!member) throw new NotFoundException('Member not found');
    const settings = await tx.librarySettings.findUnique({
      where: { orgId },
      select: { chargeStudentFines: true },
    });
    const finesAllowed =
      member.memberType !== 'STUDENT' || (settings?.chargeStudentFines ?? false);

    // The frozen figure, as captured at REPORT time. Not recomputed.
    const frozenLateAmount = report.frozenLateAmount?.toNumber() ?? null;
    let lateFineId: string | null = null;
    if (frozenLateAmount !== null && finesAllowed) {
      const lateFine = await tx.fine.create({
        data: {
          orgId,
          memberId: report.memberId,
          issueId: report.issueId,
          kind: 'OVERDUE',
          status: 'OPEN',
          amount: new Prisma.Decimal(frozenLateAmount),
          reason: 'Late charge frozen when the loss was reported',
        },
      });
      lateFineId = lateFine.id;
    }

    const resolved = resolveReplacementPrice({
      typed: typedPrice,
      titlePrice: report.copy.title.replacementPrice?.toNumber() ?? null,
      copyAcquisitionCost: report.copy.acquisitionCost?.toNumber() ?? null,
    });

    let replacementFineId: string | null = null;
    if (resolved.amount !== null && finesAllowed && resolved.source !== 'UNPRICED') {
      const replacementFine = await tx.fine.create({
        data: {
          orgId,
          memberId: report.memberId,
          issueId: report.issueId,
          kind: 'LOST',
          status: 'OPEN',
          amount: new Prisma.Decimal(resolved.amount),
          reason: `Replacement for ${report.copy.accessionNumber}`,
          amountSource: resolved.source,
          amountSetByUserId: resolved.source === 'TYPED' ? actorUserId : null,
        },
      });
      replacementFineId = replacementFine.id;
    }

    await tx.lostReport.update({
      where: { id: report.id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: now,
        confirmedByUserId: actorUserId,
        replacementAmount:
          resolved.amount === null ? null : new Prisma.Decimal(resolved.amount),
        priceSource: resolved.source === 'UNPRICED' ? null : resolved.source,
      },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.lost.confirm',
        entity: 'LostReport',
        entityId: report.id,
        after: { frozenLateAmount, replacementAmount: resolved.amount, priceSource: resolved.source },
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

  /**
   * The book turned up on the shelf that afternoon. Restores the world exactly:
   * the issue reopens, the copy goes back to ISSUED, and no money was ever
   * created because confirmation never happened.
   *
   * The late clock resumes from the original `dueAt`, INCLUDING the days
   * between report and rejection — the child did in fact still have the book
   * for all of them, and pretending otherwise would make a false report a way
   * to buy free days.
   *
   * The report row is never deleted. A rejected report is part of the history,
   * and it is also the only way anyone can later see how often this happens.
   */
  async rejectLost(
    tx: LibraryTx,
    orgId: string,
    reportId: string,
    reason: string,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<{ lostReportId: string; issueId: string | null }> {
    const report = await tx.lostReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Lost report not found');
    assertBranchInScope(report.branchId, allowedBranches);
    if (report.status !== 'REPORTED') {
      throw new ConflictException(
        `Lost report is ${report.status}; only a report awaiting confirmation can be rejected`,
      );
    }

    if (report.issueId) {
      await tx.issue.update({
        where: { id: report.issueId },
        data: { returnedAt: null, returnedByUserId: null, status: 'ACTIVE' },
      });
    }
    await tx.copy.update({
      where: { id: report.copyId },
      data: { status: report.issueId ? 'ISSUED' : 'AVAILABLE' },
    });

    await tx.lostReport.update({
      where: { id: report.id },
      data: {
        status: 'REJECTED',
        rejectedReason: reason,
        settledAt: now,
        settledByUserId: actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.lost.reject',
        entity: 'LostReport',
        entityId: report.id,
        after: { reason, issueId: report.issueId },
      },
    });

    return { lostReportId: report.id, issueId: report.issueId };
  }
}
