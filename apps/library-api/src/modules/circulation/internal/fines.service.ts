import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Fine, type LibraryTx } from '@library/db';
import type { DayReportQueryDto, ListFinesQueryDto, WaiveFineDto } from './dto';

const MS_PER_DAY = 86_400_000;

/** `Prisma.Decimal | null` (a nullable aggregate) -> plain `number`, defaulting a missing sum to 0. Same conversion loans.service.ts's `decimalToNumber` does — kept local to this module rather than shared, matching that file's own precedent of not factoring a 3-line Decimal helper out. */
function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}

export interface WaiveResult {
  fine: Fine;
}

export interface OverdueLoanItem {
  id: string;
  copyId: string;
  memberId: string;
  issuedAt: Date;
  dueAt: Date;
  renewCount: number;
  /** Whole days past `dueAt` as of the query's `now` — display only, not `computeFine`'s billable-days figure (no grace subtracted here). */
  daysOverdue: number;
}

export interface DayReport {
  date: string;
  issued: number;
  returned: number;
  overdue: number;
  finesAccrued: { count: number; amount: number };
}

/**
 * The exact SQL `listOverdue` runs, exported so the e2e suite can `EXPLAIN`
 * the SAME query the service issues — never a hand-retyped approximation of
 * it (LIBRARY-TRAPS.md #15: verification code written from memory/near-copy
 * is this project's most-repeated mistake). Shaped to match the `loan_due`
 * partial index (`Loan("orgId","dueAt") WHERE "returnedAt" IS NULL`,
 * 20260811190200_circulation migration) exactly: the same leading columns,
 * the same partial predicate, so Postgres can satisfy this with one Index
 * Scan on `loan_due` rather than a sequential scan over every loan the org
 * has ever issued.
 */
export function overdueLoansQuery(orgId: string, asOf: Date, limit = 500): Prisma.Sql {
  return Prisma.sql`
    SELECT "id", "copyId", "memberId", "issuedAt", "dueAt", "renewCount"
    FROM "Loan"
    WHERE "orgId" = ${orgId}::uuid AND "returnedAt" IS NULL AND "dueAt" < ${asOf}
    ORDER BY "dueAt" ASC
    LIMIT ${limit}
  `;
}

function dayRangeUtc(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start.getTime() + MS_PER_DAY);
  return { start, end };
}

@Injectable()
export class FinesService {
  async listFines(tx: LibraryTx, orgId: string, query: ListFinesQueryDto): Promise<Fine[]> {
    return tx.fine.findMany({
      where: {
        orgId,
        ...(query.memberId ? { memberId: query.memberId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
    });
  }

  /**
   * Waives the FULL outstanding balance (`amount - paidAmount`) of a fine —
   * `LIBRARIAN`/`ORG_OWNER` only, enforced structurally by `@Roles` on the
   * route and asserted in the authz matrix (`ASSISTANT` must be denied: see
   * `circulation.controller.ts`). `id` is a client-supplied FK, looked up on
   * `tx` — same reasoning as every other lookup in this module (Postgres FK
   * checks bypass RLS by design; the constraint alone would accept a fine
   * id from another org). A fine already `WAIVED`, or with nothing
   * outstanding (`PAID` in full), is a 409, not silently accepted.
   */
  async waive(tx: LibraryTx, orgId: string, fineId: string, dto: WaiveFineDto, actorUserId: string, now: Date): Promise<WaiveResult> {
    const fine = await tx.fine.findUnique({ where: { id: fineId } });
    if (!fine) throw new NotFoundException('Fine not found');

    if (fine.status === 'WAIVED') {
      throw new ConflictException({ reason: 'ALREADY_WAIVED', message: 'This fine has already been waived' });
    }
    const outstanding = fine.amount.minus(fine.paidAmount);
    if (outstanding.lte(0)) {
      throw new ConflictException({ reason: 'NOTHING_OUTSTANDING', message: 'This fine has no outstanding balance to waive' });
    }

    const updated = await tx.fine.update({
      where: { id: fine.id },
      data: {
        status: 'WAIVED',
        waivedByUserId: actorUserId,
        waivedAmount: outstanding,
        waivedReason: dto.reason,
        waivedAt: now,
      },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.fine.waive',
        entity: 'Fine',
        entityId: fine.id,
        before: { status: fine.status, amount: fine.amount.toString(), paidAmount: fine.paidAmount.toString() },
        after: { status: 'WAIVED', waivedAmount: outstanding.toString(), waivedReason: dto.reason },
      },
    });

    return { fine: updated };
  }

  /** See `overdueLoansQuery`'s own doc for why this delegates its SQL shape to that exported function rather than building it inline. */
  async listOverdue(tx: LibraryTx, orgId: string, now: Date): Promise<OverdueLoanItem[]> {
    const rows = await tx.$queryRaw<Array<{ id: string; copyId: string; memberId: string; issuedAt: Date; dueAt: Date; renewCount: number }>>(
      overdueLoansQuery(orgId, now),
    );
    return rows.map((r) => ({
      ...r,
      daysOverdue: Math.floor((now.getTime() - r.dueAt.getTime()) / MS_PER_DAY),
    }));
  }

  /**
   * Issued / returned / overdue counts, and fines accrued (count + amount),
   * for one UTC calendar day. `overdue` is "still outstanding AND past due
   * as of the END of that day" — not merely "overdue right now" — so a
   * historical date reconciles the same way today it will next month:
   * `dueAt < dayEnd AND (returnedAt IS NULL OR returnedAt >= dayEnd)`.
   * `finesAccrued` counts `Fine` rows CREATED that day (this codebase's only
   * fine-creation path is `loans.service.ts`'s late-return flow, kind
   * `OVERDUE`, but this counts every kind — nothing here assumes only
   * `OVERDUE` fines exist).
   */
  async dayReport(tx: LibraryTx, orgId: string, query: DayReportQueryDto): Promise<DayReport> {
    const dateStr = query.date ?? new Date().toISOString().slice(0, 10);
    const { start, end } = dayRangeUtc(dateStr);

    const [issued, returned, overdue, fineAgg] = await Promise.all([
      tx.loan.count({ where: { orgId, issuedAt: { gte: start, lt: end } } }),
      tx.loan.count({ where: { orgId, returnedAt: { gte: start, lt: end } } }),
      tx.loan.count({
        where: { orgId, dueAt: { lt: end }, OR: [{ returnedAt: null }, { returnedAt: { gte: end } }] },
      }),
      tx.fine.aggregate({ where: { orgId, createdAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    return {
      date: dateStr,
      issued,
      returned,
      overdue,
      finesAccrued: { count: fineAgg._count._all, amount: decimalToNumber(fineAgg._sum.amount) },
    };
  }
}
