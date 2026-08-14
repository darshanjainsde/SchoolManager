import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryTx } from '@library/db';
// Through the module's public interface, never into its internals — modules
// may only import each other through index.ts, so that circulation could be
// extracted into its own service later without a rewrite here.
import { computeFine, loadPolicy } from '../../circulation';

/**
 * What a borrower sees about their own account.
 *
 * Every shape in this file is deliberately NARROW, and that is the whole design
 * rather than an optimisation. A member response must never carry
 * `Title.replacementPrice`, `Copy.acquisitionCost`, `LostReport.replacementAmount`
 * or `frozenLateAmount`: the only party that tells a child what they owe for a
 * lost book is the library, after a librarian has confirmed it and looked at the
 * actual book. Trap 17 — redacting a column does not redact the join — so
 * nothing here uses `include` on a Copy or Title; every read names its columns.
 *
 * The one money figure a member DOES see is a fine that already exists and is
 * already payable. That is a bill they have been given, not a price the software
 * guessed.
 */

export interface MyIssue {
  id: string;
  accessionNumber: string;
  title: string;
  issuedAt: Date;
  dueAt: Date;
  renewCount: number;
  /** Negative once late. Computed at read time, never stored. */
  daysLeft: number;
  /** What is owed on this book RIGHT NOW if it is late. Zero when fines are off
   *  for this member type, which is the default. */
  lateChargeSoFar: number;
}

export interface MyDue {
  id: string;
  kind: 'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER';
  amount: string;
  paidAmount: string;
  waivedAmount: string | null;
  status: 'OPEN' | 'PAID' | 'WAIVED' | 'PARTIAL';
  reason: string | null;
  /** The book it concerns, by name — never its price. */
  book: string | null;
  createdAt: Date;
}

export interface MyHistoryRow {
  id: string;
  title: string;
  accessionNumber: string;
  issuedAt: Date;
  returnedAt: Date | null;
  status: 'ACTIVE' | 'RETURNED' | 'LOST';
}

const MS_PER_DAY = 86_400_000;

@Injectable()
export class MeService {
  /**
   * Resolves the caller's OWN member row from their login.
   *
   * Every method here goes through this rather than accepting a member id, so
   * there is no parameter anywhere in this module that could be made to point
   * at somebody else. A staff account with no member row simply has no library
   * account of its own, which is not an error — it is an empty list.
   */
  private async requireMember(tx: LibraryTx, actorUserId: string) {
    const user = await tx.libUser.findUnique({
      where: { id: actorUserId },
      select: { memberId: true },
    });
    if (!user?.memberId) throw new NotFoundException('This login has no library membership');
    const member = await tx.member.findUnique({ where: { id: user.memberId } });
    if (!member) throw new NotFoundException('This login has no library membership');
    return member;
  }

  /** The books they are holding right now, and when each is due back. */
  async myIssues(tx: LibraryTx, orgId: string, actorUserId: string, now: Date): Promise<MyIssue[]> {
    const member = await this.requireMember(tx, actorUserId);
    const issues = await tx.issue.findMany({
      where: { memberId: member.id, returnedAt: null },
      orderBy: { dueAt: 'asc' },
      select: {
        id: true,
        issuedAt: true,
        dueAt: true,
        renewCount: true,
        branchId: true,
        // Named columns, never `copy: true` — a whole Copy row carries
        // acquisitionCost, which is what a lost book would be priced from.
        copy: { select: { accessionNumber: true, title: { select: { title: true } } } },
      },
    });
    if (issues.length === 0) return [];

    const settings = await tx.librarySettings.findUnique({
      where: { orgId },
      select: { chargeStudentFines: true },
    });
    const finesAllowed =
      member.memberType !== 'STUDENT' || (settings?.chargeStudentFines ?? false);

    const rows: MyIssue[] = [];
    for (const issue of issues) {
      // Per issue, because a multi-branch school can have different policies.
      const policy = await loadPolicy(tx, orgId, member.memberType, issue.branchId);
      const { amount } = computeFine(policy, issue.dueAt, now);
      rows.push({
        id: issue.id,
        accessionNumber: issue.copy.accessionNumber,
        title: issue.copy.title.title,
        issuedAt: issue.issuedAt,
        dueAt: issue.dueAt,
        renewCount: issue.renewCount,
        daysLeft: Math.ceil((issue.dueAt.getTime() - now.getTime()) / MS_PER_DAY),
        lateChargeSoFar: finesAllowed ? amount : 0,
      });
    }
    return rows;
  }

  /**
   * What they owe. Only fines that EXIST — never a projection of what a lost
   * book might cost, and never anything from a report a librarian has not yet
   * confirmed, because until then no charge has been decided.
   */
  async myDues(tx: LibraryTx, actorUserId: string): Promise<MyDue[]> {
    const member = await this.requireMember(tx, actorUserId);
    const fines = await tx.fine.findMany({
      where: { memberId: member.id, status: { in: ['OPEN', 'PARTIAL'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        amount: true,
        paidAmount: true,
        waivedAmount: true,
        status: true,
        reason: true,
        createdAt: true,
        // The book's NAME. Not its price, not the copy's acquisition cost.
        issue: { select: { copy: { select: { title: { select: { title: true } } } } } },
      },
    });
    return fines.map((f) => ({
      id: f.id,
      kind: f.kind,
      amount: f.amount.toString(),
      paidAmount: f.paidAmount.toString(),
      waivedAmount: f.waivedAmount ? f.waivedAmount.toString() : null,
      status: f.status,
      reason: f.reason,
      book: f.issue?.copy.title.title ?? null,
      createdAt: f.createdAt,
    }));
  }

  /** Everything they have borrowed, most recent first. */
  async myHistory(tx: LibraryTx, actorUserId: string, limit: number): Promise<MyHistoryRow[]> {
    const member = await this.requireMember(tx, actorUserId);
    const issues = await tx.issue.findMany({
      where: { memberId: member.id },
      orderBy: { issuedAt: 'desc' },
      take: Math.min(Math.max(1, limit), 200),
      select: {
        id: true,
        issuedAt: true,
        returnedAt: true,
        status: true,
        copy: { select: { accessionNumber: true, title: { select: { title: true } } } },
      },
    });
    return issues.map((i) => ({
      id: i.id,
      title: i.copy.title.title,
      accessionNumber: i.copy.accessionNumber,
      issuedAt: i.issuedAt,
      returnedAt: i.returnedAt,
      status: i.status,
    }));
  }

  /**
   * "Is this book on the shelf?" — availability by title, for a borrower.
   *
   * Counts, never a copy list: availability is counted and never stored (§2.3),
   * and a list of copies would hand out accession numbers and acquisition costs
   * for no reason a reader has.
   *
   * There is deliberately NO reservation route here. A child cannot collect a
   * book outside their library period, so a shelf-expiry clock would punish them
   * for a timetable they do not control — "tell me when it's back" is the real
   * want, and it belongs with notifications rather than with a queue.
   */
  async availability(tx: LibraryTx, orgId: string, titleId: string) {
    const title = await tx.title.findUnique({
      where: { id: titleId },
      select: { id: true, title: true, subtitle: true, publisher: true },
    });
    if (!title) throw new NotFoundException('Title not found');

    const [counts] = await tx.$queryRaw<Array<{ total: bigint; available: bigint }>>`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE "status" = 'AVAILABLE') AS available
      FROM "Copy" WHERE "orgId" = ${orgId}::uuid AND "titleId" = ${titleId}::uuid
    `;
    return {
      ...title,
      totalCopies: Number(counts.total),
      availableNow: Number(counts.available),
    };
  }
}
