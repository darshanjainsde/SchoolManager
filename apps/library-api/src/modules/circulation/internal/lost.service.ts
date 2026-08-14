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

  /**
   * Loads a report that is ready to be settled, with its outstanding fines.
   *
   * Shared by every settlement route so "which reports can still be settled"
   * and "which fines belong to this loss" have ONE answer. The fines are found
   * through `issueId` because that is the link the loss flow writes onto both
   * of them; a stock-take loss has no issue and therefore no fines, which is
   * correct — there is nobody to charge.
   */
  private async loadSettleable(
    tx: LibraryTx,
    reportId: string,
    allowedBranches: string[],
  ) {
    const report = await tx.lostReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Lost report not found');
    assertBranchInScope(report.branchId, allowedBranches);
    if (report.status !== 'CONFIRMED') {
      throw new ConflictException(
        `Lost report is ${report.status}; only a confirmed loss can be settled`,
      );
    }
    const openFines = report.issueId
      ? await tx.fine.findMany({
          where: { issueId: report.issueId, status: { in: ['OPEN', 'PARTIAL'] } },
        })
      : [];
    return { report, openFines };
  }

  /**
   * The family paid. Money is RECORDED, not moved — there is no provider, no
   * ledger, and no receipt beyond the paper slip the librarian writes.
   *
   * IN FULL ONLY. A counter that takes ₹100 today and ₹199 next week genuinely
   * needs a payments table, because one `paidMethod` column cannot truthfully
   * describe two payments — so P3 does not offer it, and `FineStatus.PARTIAL`
   * stays unused by this path. Pay in full, or waive the remainder with a
   * reason.
   */
  async payLost(
    tx: LibraryTx,
    orgId: string,
    reportId: string,
    method: 'CASH' | 'UPI' | 'OTHER',
    note: string | undefined,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<{ lostReportId: string; paidFineIds: string[]; totalPaid: number }> {
    const { report, openFines } = await this.loadSettleable(tx, reportId, allowedBranches);

    let totalPaid = new Prisma.Decimal(0);
    const paidFineIds: string[] = [];
    for (const fine of openFines) {
      const outstanding = fine.amount.minus(fine.paidAmount);
      await tx.fine.update({
        where: { id: fine.id },
        data: {
          status: 'PAID',
          paidAmount: fine.amount,
          paidAt: now,
          paidByUserId: actorUserId,
          paidMethod: method,
          paymentNote: note,
        },
      });
      totalPaid = totalPaid.plus(outstanding);
      paidFineIds.push(fine.id);
    }

    await tx.lostReport.update({
      where: { id: report.id },
      data: { status: 'SETTLED_PAID', settledAt: now, settledByUserId: actorUserId },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.lost.pay',
        entity: 'LostReport',
        entityId: report.id,
        after: { method, note, totalPaid: totalPaid.toString(), fineIds: paidFineIds },
      },
    });

    return { lostReportId: report.id, paidFineIds, totalPaid: totalPaid.toNumber() };
  }

  /**
   * Out of print, nothing to replace it with, nobody to bill. The charge is
   * written off at ₹0 and counted as money genuinely let off.
   *
   * The approver is RECORDED, not gated. There is no principal role in this
   * service, and in a four-hundred-student school the librarian is frequently
   * the only account there is — so gating this behind a role nobody holds would
   * produce either a due that can never be closed (poisoning every "still owed"
   * figure and every future No Dues certificate) or a fake "paid" entry.
   * Instead the acting user is stored, a reason is required, and
   * `approvedByNote` captures the human who actually said yes — "Principal Mrs
   * Rao, note dated 12 Aug", the signed slip the librarian is holding. Recorded
   * approval that is auditable beats a gate that gets routed around.
   */
  async writeOffLost(
    tx: LibraryTx,
    orgId: string,
    reportId: string,
    approvedByNote: string,
    reason: string,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<{ lostReportId: string; waivedFineIds: string[]; totalWrittenOff: number }> {
    const { report, openFines } = await this.loadSettleable(tx, reportId, allowedBranches);

    let total = new Prisma.Decimal(0);
    const waivedFineIds: string[] = [];
    for (const fine of openFines) {
      const outstanding = fine.amount.minus(fine.paidAmount);
      await tx.fine.update({
        where: { id: fine.id },
        data: {
          status: 'WAIVED',
          waivedByUserId: actorUserId,
          waivedAmount: outstanding,
          waivedReason: reason,
          waiverReasonCode: 'WRITTEN_OFF_UNREPLACEABLE',
          waivedAt: now,
        },
      });
      total = total.plus(outstanding);
      waivedFineIds.push(fine.id);
    }

    await tx.lostReport.update({
      where: { id: report.id },
      data: {
        status: 'WRITTEN_OFF',
        settledAt: now,
        settledByUserId: actorUserId,
        approvedByNote,
      },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.lost.write_off',
        entity: 'LostReport',
        entityId: report.id,
        after: { approvedByNote, reason, totalWrittenOff: total.toString(), fineIds: waivedFineIds },
      },
    });

    return { lostReportId: report.id, waivedFineIds, totalWrittenOff: total.toNumber() };
  }

  /**
   * The family brought a physical replacement.
   *
   * The charge is cleared IN KIND, not forgiven — `REPLACED_IN_KIND` is a
   * mechanical waiver code precisely so the collections dashboard excludes it
   * from "let off": the school lost nothing. The frozen LATE charge is a
   * separate fine and is NOT touched; they were still late.
   *
   * The new copy is CLONED from the same title, so author, publisher, edition,
   * call number and the replacement price all come with it. The only thing
   * typed is the accession number, because the librarian has to write it inside
   * the cover by hand anyway.
   *
   * Its `acquisitionCost` is NULL, deliberately, and this overrides the
   * prototype (which set it to the price charged). `acquisitionCost` means
   * "what the school paid, from the bill" — it feeds the register's *Price
   * paid* column. The school paid nothing here. Writing the charge there would
   * put a rupee figure the school never spent into an auditor's column, and
   * worse, plant a false `PURCHASE_COST` for the price resolver to find the
   * next time this copy goes missing.
   *
   * The OLD copy keeps its number and stays LOST. A replacement is a different
   * physical object, and a retired number never returns — that is what makes
   * the register a history rather than a stock list.
   */
  async replaceInKind(
    tx: LibraryTx,
    orgId: string,
    reportId: string,
    newAccessionNumber: string,
    condition: 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | undefined,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<{ lostReportId: string; newCopyId: string; clearedFineIds: string[] }> {
    const { report, openFines } = await this.loadSettleable(tx, reportId, allowedBranches);
    const oldCopy = await tx.copy.findUnique({ where: { id: report.copyId } });
    if (!oldCopy) throw new NotFoundException('Copy not found');

    let newCopy;
    try {
      newCopy = await tx.copy.create({
        data: {
          orgId,
          titleId: oldCopy.titleId,
          branchId: oldCopy.branchId,
          accessionNumber: newAccessionNumber,
          shelf: oldCopy.shelf,
          // GOOD, not NEW: a parent's replacement is usually second-hand.
          condition: condition ?? 'GOOD',
          acquiredAt: now,
          acquisitionCost: null,
          status: 'AVAILABLE',
        },
      });
    } catch (err) {
      // `Copy_orgId_accessionNumber_key` — the number is already in the
      // register, which is exactly the collision the unique index exists to
      // catch. A retired number can never be reused, so this is also what stops
      // someone re-entering the lost book's own number.
      throw new ConflictException(
        `Accession number ${newAccessionNumber} is already in the register`,
      );
    }

    // Only the LOST fine is cleared in kind. The late charge stands.
    const clearedFineIds: string[] = [];
    for (const fine of openFines.filter((f) => f.kind === 'LOST')) {
      await tx.fine.update({
        where: { id: fine.id },
        data: {
          status: 'WAIVED',
          waivedByUserId: actorUserId,
          waivedAmount: fine.amount.minus(fine.paidAmount),
          waivedReason: `Replaced in kind — new copy ${newAccessionNumber}`,
          waiverReasonCode: 'REPLACED_IN_KIND',
          waivedAt: now,
        },
      });
      clearedFineIds.push(fine.id);
    }

    await tx.lostReport.update({
      where: { id: report.id },
      data: { status: 'SETTLED_IN_KIND', settledAt: now, settledByUserId: actorUserId },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.lost.replace_in_kind',
        entity: 'LostReport',
        entityId: report.id,
        after: {
          retiredAccessionNumber: oldCopy.accessionNumber,
          newAccessionNumber,
          newCopyId: newCopy.id,
          clearedFineIds,
        },
      },
    });

    return { lostReportId: report.id, newCopyId: newCopy.id, clearedFineIds };
  }

  /**
   * The original book turned up, after it had already been confirmed lost.
   *
   * It goes back on the shelf AT ITS OLD ACCESSION NUMBER. "A retired number
   * never returns" is a rule about REPLACEMENTS — a different physical object
   * must never inherit a number, or the register claims two books are one.
   * This is the SAME object, with that number already written in ink inside its
   * own front cover; giving it a new one would mean striking through the
   * child's book and listing one physical copy twice. The rule survives because
   * nothing was ever deleted: the row still holds `(orgId, accessionNumber)`
   * unique, so the number remains structurally unavailable to any NEW copy.
   *
   * The frozen late charge STAYS FROZEN. They were still late, and un-freezing
   * it would make "Found it" a button nobody presses — which is the one thing
   * that would actually cost the school books.
   */
  async foundLost(
    tx: LibraryTx,
    orgId: string,
    reportId: string,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<{ lostReportId: string; accessionNumber: string; clearedFineIds: string[] }> {
    const { report, openFines } = await this.loadSettleable(tx, reportId, allowedBranches);
    const copy = await tx.copy.findUnique({ where: { id: report.copyId } });
    if (!copy) throw new NotFoundException('Copy not found');

    await tx.copy.update({ where: { id: copy.id }, data: { status: 'AVAILABLE' } });

    const clearedFineIds: string[] = [];
    for (const fine of openFines.filter((f) => f.kind === 'LOST')) {
      await tx.fine.update({
        where: { id: fine.id },
        data: {
          status: 'WAIVED',
          waivedByUserId: actorUserId,
          waivedAmount: fine.amount.minus(fine.paidAmount),
          waivedReason: 'The original copy was found',
          waiverReasonCode: 'BOOK_FOUND',
          waivedAt: now,
        },
      });
      clearedFineIds.push(fine.id);
    }

    await tx.lostReport.update({
      where: { id: report.id },
      data: { status: 'FOUND', settledAt: now, settledByUserId: actorUserId },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.lost.found',
        entity: 'LostReport',
        entityId: report.id,
        after: { accessionNumber: copy.accessionNumber, clearedFineIds },
      },
    });

    return { lostReportId: report.id, accessionNumber: copy.accessionNumber, clearedFineIds };
  }

  /**
   * A book is missing from the shelf and nobody has it — found during stock
   * verification.
   *
   * A separate route, with no member and no issue, and that separation is the
   * point. Without it a librarian has to invent a fake issue to a child in
   * order to record a missing book, which puts a loss on a real person's record
   * and, if fines are on, a bill on their parent. The
   * `LostReport_member_and_issue_together` CHECK makes attaching a member here
   * structurally impossible rather than merely discouraged.
   *
   * Ships in P3 even though the stock-take SCREEN is P5: the screen can wait,
   * the fake issue cannot.
   */
  async reportMissing(
    tx: LibraryTx,
    orgId: string,
    accessionNumber: string,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<{ lostReportId: string }> {
    const copy = await tx.copy.findUnique({
      where: { orgId_accessionNumber: { orgId, accessionNumber } },
    });
    if (!copy) throw new NotFoundException('Copy not found');
    assertBranchInScope(copy.branchId, allowedBranches);

    const activeIssue = await tx.issue.findFirst({
      where: { copyId: copy.id, returnedAt: null },
    });
    if (activeIssue) {
      // Somebody does have it — this is a loss with a holder, and it must go
      // through the flow that freezes their charge and bills them, not through
      // the one that says nobody had it.
      throw new ConflictException(
        'This copy is issued to a member — report it lost against that issue instead',
      );
    }

    await tx.copy.update({ where: { id: copy.id }, data: { status: 'LOST' } });

    const report = await tx.lostReport.create({
      data: {
        orgId,
        copyId: copy.id,
        branchId: copy.branchId,
        // Both null, together — the CHECK enforces it.
        memberId: null,
        issueId: null,
        reportedByUserId: actorUserId,
        selfReported: false,
        reportedAt: now,
        // Straight to CONFIRMED: there is no money to wait for and nobody to
        // confirm it against.
        status: 'CONFIRMED',
        confirmedAt: now,
        confirmedByUserId: actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.lost.missing_at_stock_take',
        entity: 'LostReport',
        entityId: report.id,
        after: { accessionNumber, copyId: copy.id },
      },
    });

    return { lostReportId: report.id };
  }
}
