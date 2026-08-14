import { Injectable, NotFoundException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import { parseAccessionRanges } from './ranges';

/**
 * The accession register and the annual stock take.
 *
 * The register is a HISTORY, not a stock list. A lost or withdrawn copy keeps
 * its row and its number for good — that is exactly what an auditor checks,
 * and it is why a replacement is a new row with the next number rather than an
 * edit of the old one.
 */

/** The fourteen canonical columns, in the order the bound book has them. */
export interface RegisterRow {
  date: Date | null;
  accessionNumber: string;
  author: string | null;
  title: string;
  edition: string | null;
  volume: string | null;
  publisher: string | null;
  year: number | null;
  pages: number | null;
  source: string | null;
  /** What the school PAID, from the bill. Never the replacement price. */
  pricePaid: string | null;
  callNumber: string | null;
  billNumber: string | null;
  remarks: string | null;
}

export interface StockTakeResult {
  checked: number;
  present: Array<{ accessionNumber: string; title: string }>;
  /** On the register, not on the shelf, and not explained by a loan or a loss. */
  missing: Array<{ accessionNumber: string; title: string; status: string }>;
  /** Absent from the shelf for a REASON the register already knows. */
  accountedFor: Array<{ accessionNumber: string; title: string; status: string; note: string }>;
  /** Typed, but no such number in this library. */
  unknown: string[];
  /** Could not be understood — shown verbatim so it can be retyped. */
  unparsed: string[];
}

@Injectable()
export class RegisterService {
  /**
   * The register, in accession order — the only order it is ever read in.
   *
   * Includes LOST and WITHDRAWN copies, deliberately. Filtering them out would
   * make this a stock list, and the whole point of the register is that a
   * number, once used, has a permanent row explaining what became of it.
   */
  async list(
    tx: LibraryTx,
    orgId: string,
    opts: { limit: number; offset: number; branchId?: string },
  ): Promise<RegisterRow[]> {
    const copies = await tx.copy.findMany({
      where: { orgId, ...(opts.branchId ? { branchId: opts.branchId } : {}) },
      orderBy: { accessionNumber: 'asc' },
      take: opts.limit,
      skip: opts.offset,
      select: {
        accessionNumber: true,
        acquiredAt: true,
        acquisitionCost: true,
        source: true,
        billNumber: true,
        volume: true,
        remarks: true,
        status: true,
        withdrawnReason: true,
        title: {
          select: {
            title: true,
            edition: true,
            publisher: true,
            publishedYear: true,
            pageCount: true,
            callNumber: true,
            authors: { select: { author: { select: { name: true } } }, take: 1 },
          },
        },
      },
    });

    return copies.map((c) => ({
      date: c.acquiredAt,
      accessionNumber: c.accessionNumber,
      author: c.title.authors[0]?.author.name ?? null,
      title: c.title.title,
      edition: c.title.edition,
      volume: c.volume,
      publisher: c.title.publisher,
      year: c.title.publishedYear,
      pages: c.title.pageCount,
      source: c.source,
      pricePaid: c.acquisitionCost ? c.acquisitionCost.toString() : null,
      callNumber: c.title.callNumber,
      billNumber: c.billNumber,
      // What became of it. A register row for a lost book that did not say so
      // would be the one thing an auditor is looking for and cannot find.
      remarks: this.remarksFor(c.status, c.withdrawnReason, c.remarks),
    }));
  }

  private remarksFor(status: string, withdrawnReason: string | null, remarks: string | null) {
    const parts: string[] = [];
    if (status === 'LOST') parts.push('Lost');
    if (status === 'WITHDRAWN') parts.push(`Withdrawn${withdrawnReason ? ` — ${withdrawnReason}` : ''}`);
    if (remarks) parts.push(remarks);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  /**
   * Walk the shelves, type what you see, and reconcile it against the register.
   *
   * Stateless on purpose: no session table, no half-finished stock take to
   * resume or to leave stale. The librarian holds the paper, the request holds
   * the numbers, and the answer is computed fresh — which also means two people
   * can verify two shelves at once without coordinating.
   *
   * The important distinction is MISSING versus ACCOUNTED FOR. A book that is
   * issued to a child is not on the shelf and is not missing; neither is one
   * already recorded lost. Reporting those as missing would bury the handful of
   * genuinely unexplained gaps — which are the entire output of the exercise —
   * under a hundred rows that are working exactly as intended.
   */
  async stockTake(
    tx: LibraryTx,
    orgId: string,
    input: string,
    branchId?: string,
  ): Promise<StockTakeResult> {
    const { numbers, unparsed } = parseAccessionRanges(input);
    if (numbers.length === 0) {
      return { checked: 0, present: [], missing: [], accountedFor: [], unknown: [], unparsed };
    }

    const copies = await tx.copy.findMany({
      where: {
        orgId,
        accessionNumber: { in: numbers },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        accessionNumber: true,
        status: true,
        title: { select: { title: true } },
        issues: {
          where: { returnedAt: null },
          select: { member: { select: { firstName: true, lastName: true } } },
          take: 1,
        },
      },
    });

    const found = new Set(copies.map((c) => c.accessionNumber));
    const present: StockTakeResult['present'] = [];
    const missing: StockTakeResult['missing'] = [];
    const accountedFor: StockTakeResult['accountedFor'] = [];

    for (const c of copies) {
      const row = { accessionNumber: c.accessionNumber, title: c.title.title };
      if (c.status === 'AVAILABLE' || c.status === 'RESERVED_SHELF') {
        // On the register and on the shelf: the ordinary case.
        present.push(row);
      } else if (c.status === 'ISSUED') {
        const holder = c.issues[0]?.member;
        accountedFor.push({
          ...row,
          status: c.status,
          note: holder ? `with ${holder.firstName} ${holder.lastName}` : 'on loan',
        });
      } else if (c.status === 'LOST') {
        accountedFor.push({ ...row, status: c.status, note: 'already recorded lost' });
      } else if (c.status === 'WITHDRAWN') {
        accountedFor.push({ ...row, status: c.status, note: 'withdrawn from stock' });
      } else {
        accountedFor.push({ ...row, status: c.status, note: c.status.toLowerCase() });
      }
    }

    // Numbers the librarian typed that this library has never issued.
    const unknown = numbers.filter((n) => !found.has(n));

    return {
      checked: numbers.length,
      present,
      missing,
      accountedFor,
      unknown,
      unparsed,
    };
  }

  /**
   * What the register says SHOULD be on a shelf but was not typed — the actual
   * output of a stock take, and the reason it is a separate call: the librarian
   * finishes a range first, then asks "what have I not accounted for".
   */
  async unaccountedFor(
    tx: LibraryTx,
    orgId: string,
    seen: string,
    branchId?: string,
  ): Promise<StockTakeResult['missing']> {
    const { numbers } = parseAccessionRanges(seen);
    const expected = await tx.copy.findMany({
      where: {
        orgId,
        ...(branchId ? { branchId } : {}),
        // Only copies the register claims are ON THE SHELF. A book on loan or
        // already recorded lost is absent for a reason nobody needs to chase.
        status: { in: ['AVAILABLE', 'RESERVED_SHELF'] },
        ...(numbers.length > 0 ? { accessionNumber: { notIn: numbers } } : {}),
      },
      orderBy: { accessionNumber: 'asc' },
      select: { accessionNumber: true, status: true, title: { select: { title: true } } },
    });
    return expected.map((c) => ({
      accessionNumber: c.accessionNumber,
      title: c.title.title,
      status: c.status,
    }));
  }

  /**
   * Weeding: taking a book out of stock on purpose.
   *
   * The number is NOT freed. A withdrawn copy keeps its row and its number for
   * the same reason a lost one does — the register is a history. Reason and
   * approver are required, because `WITHDRAWN` with neither is indistinguishable
   * from a mistake a year later, and this is the one action that removes a book
   * nobody has complained about.
   */
  async weed(
    tx: LibraryTx,
    orgId: string,
    copyId: string,
    reason: string,
    approvedByNote: string,
    actorUserId: string,
    now: Date,
  ) {
    const copy = await tx.copy.findUnique({ where: { id: copyId } });
    if (!copy) throw new NotFoundException('Copy not found');

    const activeIssue = await tx.issue.findFirst({
      where: { copyId, returnedAt: null },
      select: { id: true },
    });
    if (activeIssue) {
      throw new NotFoundException('This copy is with a member — take it back before withdrawing it');
    }

    const updated = await tx.copy.update({
      where: { id: copyId },
      data: {
        status: 'WITHDRAWN',
        withdrawnAt: now,
        withdrawnReason: reason,
        withdrawnByUserId: actorUserId,
        withdrawnApprovedByNote: approvedByNote,
      },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'catalog.copy.weed',
        entity: 'Copy',
        entityId: copyId,
        before: { status: copy.status },
        after: { status: 'WITHDRAWN', reason, approvedByNote },
      },
    });

    return updated;
  }
}
