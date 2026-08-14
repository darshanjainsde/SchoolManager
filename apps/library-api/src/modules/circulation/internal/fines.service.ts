import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Fine, type LibraryTx } from '@library/db';
import { assertBranchInScope } from '../../../common/guards/assert-branch-in-scope';
import type { CollectionsQueryDto, DayReportQueryDto, ListDuesQueryDto, ListFinesQueryDto, PayFineDto, WaiveFineDto } from './dto';
import { MEMBER_CARD_SELECT, type MemberCard } from './members.service';

const MS_PER_DAY = 86_400_000;

/**
 * Money representation, decided for this task: DECIMAL STRINGS everywhere,
 * not numbers, not integer minor units. Every `Fine` money column
 * (`amount`/`paidAmount`/`waivedAmount`) already comes back as a string on
 * every route that returns a `Fine` row directly (`listFines`, `waive`) —
 * Prisma's `Decimal.toJSON()` returns `.toString()`. `dayReport`'s
 * `finesAccrued.amount` was the ONE place that diverged: it went through
 * `.toNumber()` first, so a fine came back as `"12.5"` while the day report
 * emitted `12.5` as a JS number for the same kind of figure. Picking the
 * string form (over converting the ALREADY-SHIPPED `Fine` routes to numbers,
 * or to minor-unit integers everywhere) costs nothing on the write path —
 * `Prisma.Decimal` accepts a string directly — and preserves exact decimal
 * precision without a cents-conversion helper at every read/write site
 * across a still-growing money surface (`CirculationPolicy.finePerDay`/
 * `maxFine`, and Phase 3's `Invoice`/`Payment`/`Expense`).
 */
function decimalToMoneyString(value: Prisma.Decimal | null | undefined): string {
  return value ? value.toString() : '0';
}

export interface WaiveResult {
  fine: Fine;
}

export interface FineListItem extends Fine {
  member: MemberCard;
  /** Null for a fine raised without a issue behind it (damage, lost item). */
  issue: { copy: { title: { id: string; title: string } } } | null;
}

/** One row per MEMBER, which is how the question is actually asked. */
export interface DuesRow {
  memberId: string;
  code: string;
  firstName: string;
  lastName: string;
  memberType: 'STUDENT' | 'TEACHER' | 'EXTERNAL';
  /** As the librarian writes it (`6-B`). Free text — see Member.classRef. */
  classRef: string | null;
  /** Outstanding: amount minus what has been paid and what has been waived. */
  owed: number;
  fineCount: number;
  /** Why they owe it, deduplicated — OVERDUE, LOST, DAMAGE, OTHER. */
  kinds: Array<'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER'>;
}

export interface OverdueIssueItem {
  id: string;
  copyId: string;
  memberId: string;
  issuedAt: Date;
  dueAt: Date;
  renewCount: number;
  /** Whole days past `dueAt` as of the query's `now` — display only, not `computeFine`'s billable-days figure (no grace subtracted here). */
  daysOverdue: number;
  member: MemberCard;
  title: { id: string; title: string };
  accessionNumber: string;
}

export interface CollectionsReport {
  from: string;
  to: string;
  /** Money actually taken in the window. */
  collected: number;
  /** Money genuinely FORGIVEN — hardship, library error, goodwill, write-off.
   *  Excludes the two mechanical codes: the school lost nothing when a book was
   *  found or replaced in kind, and counting those would make this figure
   *  useless for the only question it is asked. */
  letOff: number;
  /** The mechanical waivers, reported separately so they are visible but never
   *  mistaken for generosity. */
  clearedInKind: number;
  /** A POSITION, not a flow: what is outstanding right now, unbounded by the window. */
  stillOwed: number;
  membersOwing: number;
  byReason: Array<{ kind: 'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER'; collected: number; owed: number }>;
  byMethod: Array<{ method: 'CASH' | 'UPI' | 'OTHER' | 'UNRECORDED'; collected: number; count: number }>;
}

export interface WaiverLogRow {
  fineId: string;
  member: MemberCard;
  classRef: string | null;
  kind: 'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER';
  amount: string;
  reasonCode: string | null;
  reason: string | null;
  waivedAt: Date | null;
  waivedByUserId: string | null;
  book: string | null;
  accessionNumber: string | null;
  mechanical: boolean;
}

export interface DayReport {
  date: string;
  issued: number;
  returned: number;
  overdue: number;
  /** `amount` is a decimal STRING — see `decimalToMoneyString`'s own doc for why. */
  finesAccrued: { count: number; amount: string };
}

/**
 * The exact SQL `listOverdue` runs, exported so the e2e suite can `EXPLAIN`
 * the SAME query the service issues — never a hand-retyped approximation of
 * it (LIBRARY-TRAPS.md #15: verification code written from memory/near-copy
 * is this project's most-repeated mistake). Shaped to match the `issue_due`
 * partial index (`Issue("orgId","dueAt") WHERE "returnedAt" IS NULL`,
 * 20260811190200_circulation migration) exactly: the same leading columns,
 * the same partial predicate, so Postgres can satisfy this with one Index
 * Scan on `issue_due` rather than a sequential scan over every issue the org
 * has ever issued. `allowedBranches` (empty = all) adds one extra AND'd
 * predicate on `"branchId"` — it does not change the leading columns the
 * `issue_due` index scan matches, only what's filtered after that scan.
 */
export function overdueIssuesQuery(orgId: string, asOf: Date, allowedBranches: string[] = [], limit = 500): Prisma.Sql {
  const branchClause =
    allowedBranches.length > 0 ? Prisma.sql`AND "branchId" = ANY(${allowedBranches}::uuid[])` : Prisma.empty;
  return Prisma.sql`
    SELECT "id", "copyId", "memberId", "issuedAt", "dueAt", "renewCount"
    FROM "Issue"
    WHERE "orgId" = ${orgId}::uuid AND "returnedAt" IS NULL AND "dueAt" < ${asOf} ${branchClause}
    ORDER BY "dueAt" ASC
    LIMIT ${limit}
  `;
}

/**
 * Day boundaries in the ORG'S OWN timezone (`LibraryOrg.timezone`, default
 * `Asia/Kolkata`), not UTC. Previously `dayRangeUtc` treated `dateStr` as a
 * UTC calendar day — 5.5 hours wrong for an Indian school: a 21:00 IST issue
 * is 15:30 UTC, still the SAME UTC calendar day, so that part actually
 * agreed by coincidence; the divergence bites at the edges, e.g. a 21:30 IST
 * issue (16:00 UTC) lands fine, but anything issued between 00:00 and 05:29
 * IST is still the PREVIOUS UTC day, so the desk's "today" and the report's
 * "today" disagree every night across that window — see the task's own
 * proof scenario.
 *
 * `(dateStr::date)::timestamp AT TIME ZONE o.timezone` interprets the given
 * calendar date as MIDNIGHT WALL-CLOCK TIME IN THE ORG'S ZONE and returns
 * the equivalent UTC instant — computed in Postgres deliberately, not
 * reimplemented as a fixed-offset shift in JS, so it stays correct for any
 * IANA zone Postgres knows about (DST transitions included), not just
 * Kolkata's fixed +05:30. `orgId`/`timezone` are both bound parameters, not
 * string-interpolated, regardless of the source being a config default today.
 */
async function dayRangeForOrg(
  tx: LibraryTx,
  orgId: string,
  dateStr: string | null,
): Promise<{ start: Date; end: Date; date: string }> {
  /*
   * "Today" is resolved HERE, in SQL, against the org's own timezone — never
   * by the caller.
   *
   * It used to default to `new Date().toISOString().slice(0, 10)`, which is
   * the UTC date, and that string was then interpreted as a day in the org's
   * timezone. For an Asia/Kolkata school those disagree for 5.5 hours every
   * day: between 18:30 and 24:00 UTC it is already tomorrow in IST, so the
   * report asked for YESTERDAY's window and returned zero for books issued
   * minutes earlier. Any librarian looking at the console between midnight
   * and 05:30 IST saw an empty day.
   *
   * A branch-scope e2e test caught this only because the suite happened to run
   * across the IST midnight boundary — it had passed every previous run.
   *
   * The resolved date is returned so the response reports the day it actually
   * measured rather than the one the caller guessed.
   */
  const rows = await tx.$queryRaw<Array<{ start: Date; end: Date; date: string }>>`
    SELECT
      (COALESCE(${dateStr}::date, (now() AT TIME ZONE o."timezone")::date))::timestamp
        AT TIME ZONE o."timezone" AS "start",
      ((COALESCE(${dateStr}::date, (now() AT TIME ZONE o."timezone")::date)) + 1)::timestamp
        AT TIME ZONE o."timezone" AS "end",
      to_char(COALESCE(${dateStr}::date, (now() AT TIME ZONE o."timezone")::date), 'YYYY-MM-DD') AS "date"
    FROM "LibraryOrg" o
    WHERE o."id" = ${orgId}::uuid
  `;
  const row = rows[0];
  if (!row) throw new NotFoundException('Org not found');
  return { start: row.start, end: row.end, date: row.date };
}

@Injectable()
export class FinesService {
  /**
   * Branch filter joins through `issue` because `Fine` carries no `branchId`
   * of its own (only `Issue`/`Reservation` gained one — see the branch-scope
   * migration's own doc; a Fine is money owed by a MEMBER, not tied to one
   * branch the way a Copy is). A fine with `issueId: null` (this codebase's
   * only fine-creation path always sets one — `issues.service.ts`'s late
   * return flow — but `kind` also allows DAMAGE/LOST/OTHER for a future
   * issue-less fee) has no branch to attribute, so it is visible to every
   * branch-scoped caller rather than hidden from all of them — the same
   * "unknown branch passes through" convention `listReservations` uses for a still-
   * PENDING reservation.
   */
  async listFines(tx: LibraryTx, orgId: string, query: ListFinesQueryDto, allowedBranches: string[]): Promise<FineListItem[]> {
    return tx.fine.findMany({
      where: {
        orgId,
        ...(query.memberId ? { memberId: query.memberId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(allowedBranches.length > 0
          ? { OR: [{ issueId: null }, { issue: { branchId: { in: allowedBranches } } }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      // Who owes it, and for which book. A fine with no issue (a damage or
      // lost-item charge raised directly) legitimately has no title, which is
      // why `title` is nullable here rather than assumed present.
      include: {
        member: { select: MEMBER_CARD_SELECT },
        issue: { select: { copy: { select: { title: { select: { id: true, title: true } } } } } },
      },
    });
  }

  /**
   * The dues list, shaped the way the question is actually asked.
   *
   * `listFines` above is FINE-shaped: a flat feed ordered by `createdAt`, hard
   * capped at 50. But nobody stands at a counter asking "show me the most
   * recent fifty fines" — they ask "does Meera owe anything?", and today that
   * takes scrolling and mental arithmetic. This returns ONE ROW PER MEMBER,
   * with what they owe and what it is for.
   *
   * `memberType` is a first-class filter, not a convenience. A teacher's ₹300
   * must never be inside a figure a principal reads as "what the children owe",
   * and the approved prototype's tile says "Students owing", not "Members
   * owing". Splitting here is what makes that possible without a second query
   * shape later.
   *
   * Aggregated in SQL rather than by loading fines and summing in JS: a school
   * with three hundred members and years of history would otherwise pull every
   * fine row it has ever raised to answer one screen.
   */
  async listDues(
    tx: LibraryTx,
    orgId: string,
    query: ListDuesQueryDto,
    allowedBranches: string[],
  ): Promise<DuesRow[]> {
    const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
    const offset = Math.max(0, query.offset ?? 0);

    // Outstanding, not `amount`: a partially paid or partially waived fine owes
    // the remainder, and a fully settled one owes nothing and must not appear.
    const rows = await tx.$queryRaw<
      Array<{
        memberId: string;
        code: string;
        firstName: string;
        lastName: string;
        memberType: 'STUDENT' | 'TEACHER' | 'EXTERNAL';
        classRef: string | null;
        owed: Prisma.Decimal;
        fineCount: bigint;
        kinds: string[];
      }>
    >`
      SELECT m."id"          AS "memberId",
             m."code",
             m."firstName",
             m."lastName",
             m."memberType",
             m."classRef",
             SUM(f."amount" - f."paidAmount" - COALESCE(f."waivedAmount", 0)) AS "owed",
             COUNT(f."id")                                                   AS "fineCount",
             ARRAY_AGG(DISTINCT f."kind"::text)                              AS "kinds"
      FROM "Fine" f
      JOIN "Member" m ON m."id" = f."memberId"
      LEFT JOIN "Issue" i ON i."id" = f."issueId"
      WHERE f."orgId" = ${orgId}::uuid
        AND f."status" IN ('OPEN', 'PARTIAL')
        AND (${query.memberType ?? null}::text IS NULL OR m."memberType"::text = ${query.memberType ?? null})
        AND (
          ${allowedBranches.length === 0}
          OR f."issueId" IS NULL
          OR i."branchId" = ANY (${allowedBranches}::uuid[])
        )
      GROUP BY m."id", m."code", m."firstName", m."lastName", m."memberType", m."classRef"
      HAVING SUM(f."amount" - f."paidAmount" - COALESCE(f."waivedAmount", 0)) > 0
      ORDER BY "owed" DESC, m."lastName" ASC, m."firstName" ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return rows.map((r) => ({
      memberId: r.memberId,
      code: r.code,
      firstName: r.firstName,
      lastName: r.lastName,
      memberType: r.memberType,
      classRef: r.classRef,
      owed: r.owed.toNumber(),
      fineCount: Number(r.fineCount),
      kinds: r.kinds as DuesRow['kinds'],
    }));
  }

  /**
   * Collections: what came in, what is still owed, and what was let off.
   *
   * The one rule that makes this honest is the MECHANICAL exclusion.
   * `BOOK_FOUND` and `REPLACED_IN_KIND` are waivers in the database — the fine
   * is closed without money — but the school lost NOTHING in either case: it
   * has the book back, or an equivalent one. Counting them as "let off" would
   * inflate a school's apparent generosity with what is really book-keeping,
   * and would make the figure useless for the only question it is asked:
   * how much did we actually forgive?
   *
   * Day boundaries come from `dayRangeForOrg`, reusing the org-timezone logic
   * rather than re-deriving it — the day report already shipped a bug where a
   * UTC-derived "today" made an Indian school's evening disappear.
   */
  async collections(
    tx: LibraryTx,
    orgId: string,
    query: CollectionsQueryDto,
    allowedBranches: string[],
  ): Promise<CollectionsReport> {
    const from = await dayRangeForOrg(tx, orgId, query.from ?? null);
    const to = await dayRangeForOrg(tx, orgId, query.to ?? query.from ?? null);
    const start = from.start;
    const end = to.end;

    const branchOk = Prisma.sql`(
      ${allowedBranches.length === 0}
      OR f."issueId" IS NULL
      OR EXISTS (SELECT 1 FROM "Issue" i WHERE i."id" = f."issueId" AND i."branchId" = ANY (${allowedBranches}::uuid[]))
    )`;

    // MECHANICAL waivers, named once and used everywhere below.
    const mechanical = Prisma.sql`('BOOK_FOUND', 'REPLACED_IN_KIND')`;

    const [totals] = await tx.$queryRaw<
      Array<{ collected: Prisma.Decimal; letOff: Prisma.Decimal; clearedInKind: Prisma.Decimal }>
    >`
      SELECT
        COALESCE(SUM(f."paidAmount") FILTER (WHERE f."paidAt" >= ${start} AND f."paidAt" < ${end}), 0) AS "collected",
        COALESCE(SUM(f."waivedAmount") FILTER (
          WHERE f."waivedAt" >= ${start} AND f."waivedAt" < ${end}
            AND (f."waiverReasonCode" IS NULL OR f."waiverReasonCode"::text NOT IN ${mechanical})
        ), 0) AS "letOff",
        COALESCE(SUM(f."waivedAmount") FILTER (
          WHERE f."waivedAt" >= ${start} AND f."waivedAt" < ${end}
            AND f."waiverReasonCode"::text IN ${mechanical}
        ), 0) AS "clearedInKind"
      FROM "Fine" f
      WHERE f."orgId" = ${orgId}::uuid AND ${branchOk}
    `;

    // Still owed is a POSITION, not a flow — it is not bounded by the date
    // window, because "what is outstanding right now" is the question.
    const [outstanding] = await tx.$queryRaw<Array<{ owed: Prisma.Decimal; members: bigint }>>`
      SELECT COALESCE(SUM(f."amount" - f."paidAmount" - COALESCE(f."waivedAmount", 0)), 0) AS "owed",
             COUNT(DISTINCT f."memberId")                                                  AS "members"
      FROM "Fine" f
      WHERE f."orgId" = ${orgId}::uuid AND f."status" IN ('OPEN', 'PARTIAL') AND ${branchOk}
    `;

    const byReason = await tx.$queryRaw<Array<{ kind: string; collected: Prisma.Decimal; owed: Prisma.Decimal }>>`
      SELECT f."kind"::text AS "kind",
             COALESCE(SUM(f."paidAmount") FILTER (WHERE f."paidAt" >= ${start} AND f."paidAt" < ${end}), 0) AS "collected",
             COALESCE(SUM(f."amount" - f."paidAmount" - COALESCE(f."waivedAmount", 0))
                      FILTER (WHERE f."status" IN ('OPEN', 'PARTIAL')), 0) AS "owed"
      FROM "Fine" f
      WHERE f."orgId" = ${orgId}::uuid AND ${branchOk}
      GROUP BY f."kind"
      ORDER BY "collected" DESC
    `;

    const byMethod = await tx.$queryRaw<Array<{ method: string; collected: Prisma.Decimal; count: bigint }>>`
      SELECT COALESCE(f."paidMethod"::text, 'UNRECORDED') AS "method",
             COALESCE(SUM(f."paidAmount"), 0)             AS "collected",
             COUNT(*)                                     AS "count"
      FROM "Fine" f
      WHERE f."orgId" = ${orgId}::uuid AND f."paidAt" >= ${start} AND f."paidAt" < ${end} AND ${branchOk}
      GROUP BY f."paidMethod"
      ORDER BY "collected" DESC
    `;

    return {
      from: from.date,
      to: to.date,
      collected: totals.collected.toNumber(),
      letOff: totals.letOff.toNumber(),
      clearedInKind: totals.clearedInKind.toNumber(),
      stillOwed: outstanding.owed.toNumber(),
      membersOwing: Number(outstanding.members),
      byReason: byReason.map((r) => ({
        kind: r.kind as CollectionsReport['byReason'][number]['kind'],
        collected: r.collected.toNumber(),
        owed: r.owed.toNumber(),
      })),
      byMethod: byMethod.map((r) => ({
        method: r.method as CollectionsReport['byMethod'][number]['method'],
        collected: r.collected.toNumber(),
        count: Number(r.count),
      })),
    };
  }

  /**
   * Every waiver, with its reason and who granted it — the log an owner reads.
   *
   * Mechanical waivers are INCLUDED here, unlike in the money total above, and
   * flagged. "The book was found" belongs in the audit trail; it just does not
   * belong in "how much did we forgive".
   */
  async waiverLog(
    tx: LibraryTx,
    orgId: string,
    limit: number,
    allowedBranches: string[],
  ): Promise<WaiverLogRow[]> {
    const rows = await tx.fine.findMany({
      where: {
        orgId,
        status: 'WAIVED',
        ...(allowedBranches.length > 0
          ? { OR: [{ issueId: null }, { issue: { branchId: { in: allowedBranches } } }] }
          : {}),
      },
      orderBy: { waivedAt: 'desc' },
      take: Math.min(Math.max(1, limit), 200),
      include: {
        member: { select: MEMBER_CARD_SELECT },
        issue: { select: { copy: { select: { accessionNumber: true, title: { select: { title: true } } } } } },
      },
    });

    return rows.map((f) => ({
      fineId: f.id,
      member: f.member,
      classRef: null,
      kind: f.kind,
      amount: decimalToMoneyString(f.waivedAmount),
      reasonCode: f.waiverReasonCode,
      reason: f.waivedReason,
      waivedAt: f.waivedAt,
      waivedByUserId: f.waivedByUserId,
      book: f.issue ? f.issue.copy.title.title : null,
      accessionNumber: f.issue ? f.issue.copy.accessionNumber : null,
      /** True when the school lost nothing — excluded from the let-off total. */
      mechanical:
        f.waiverReasonCode === 'BOOK_FOUND' || f.waiverReasonCode === 'REPLACED_IN_KIND',
    }));
  }

  /**
   * Records that a fine was paid at the counter.
   *
   * Without this the money story had a hole big enough to make the collections
   * screen lie: `payLost` only settles a CONFIRMED lost report, so an ordinary
   * late-return fine — the commonest charge in the service — had exactly one
   * route that could close it, `waive`, which books it as money LET OFF. A
   * librarian who took ₹15 across the desk either left the fine open forever or
   * recorded revenue as forgiveness.
   *
   * IN FULL ONLY, for the same reason `payLost` is: a counter that takes ₹100
   * today and ₹99 next week needs a payments table, because one `paidMethod`
   * column cannot describe two payments. `FineStatus.PARTIAL` stays unused by
   * this path — pay in full, or waive the remainder with a reason.
   *
   * READERS, not WRITERS: taking money at the desk is desk work. Forgiving it
   * is not, which is why `waive` excludes ASSISTANT and this does not.
   */
  async pay(
    tx: LibraryTx,
    orgId: string,
    fineId: string,
    dto: PayFineDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<WaiveResult> {
    const fine = await tx.fine.findUnique({
      where: { id: fineId },
      include: { issue: { select: { branchId: true } } },
    });
    if (!fine) throw new NotFoundException('Fine not found');
    if (fine.issue) assertBranchInScope(fine.issue.branchId, allowedBranches);

    const outstanding = fine.amount.minus(fine.paidAmount).minus(fine.waivedAmount ?? 0);
    if (outstanding.lte(0)) {
      throw new ConflictException({
        reason: 'NOTHING_OUTSTANDING',
        message: 'This fine has nothing left to pay',
      });
    }

    // Compare-and-swap on the status, the same lesson P3's settlements learned:
    // two clerks taking the same payment must not both succeed and double the
    // recorded revenue. `updateMany` re-evaluates its WHERE after the row lock.
    const { count } = await tx.fine.updateMany({
      where: { id: fine.id, status: { in: ['OPEN', 'PARTIAL'] } },
      data: {
        status: 'PAID',
        paidAmount: fine.amount.minus(fine.waivedAmount ?? 0),
        paidAt: now,
        paidByUserId: actorUserId,
        paidMethod: dto.method,
        paymentNote: dto.note,
      },
    });
    if (count === 0) {
      throw new ConflictException({
        reason: 'ALREADY_SETTLED',
        message: 'This fine was settled by someone else a moment ago',
      });
    }

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.fine.pay',
        entity: 'Fine',
        entityId: fine.id,
        before: { status: fine.status, paidAmount: fine.paidAmount.toString() },
        after: { status: 'PAID', amount: outstanding.toString(), method: dto.method, note: dto.note },
      },
    });

    return { fine: (await tx.fine.findUnique({ where: { id: fine.id } }))! };
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
   *
   * Branch-scope checked via the fine's LOAN (same join reasoning as
   * `listFines` above) only when one exists — a issue-less fine has no branch
   * to check against, same "unknown passes through" convention.
   */
  async waive(
    tx: LibraryTx,
    orgId: string,
    fineId: string,
    dto: WaiveFineDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<WaiveResult> {
    const fine = await tx.fine.findUnique({ where: { id: fineId }, include: { issue: { select: { branchId: true } } } });
    if (!fine) throw new NotFoundException('Fine not found');
    if (fine.issue) assertBranchInScope(fine.issue.branchId, allowedBranches);

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
        // The CODE is what the collections dashboard aggregates on. Free text
        // alone cannot answer "where did each rupee go", and it is also how
        // "replaced in kind" and "book found" end up inflating a school's
        // "let off" figure when it lost nothing either time.
        waiverReasonCode: dto.reasonCode,
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
        after: { status: 'WAIVED', waivedAmount: outstanding.toString(), waivedReason: dto.reason, waiverReasonCode: dto.reasonCode },
      },
    });

    return { fine: updated };
  }

  /**
   * See `overdueIssuesQuery`'s own doc for why this delegates its SQL shape to
   * that exported function rather than building it inline.
   *
   * The member and title are fetched by TWO follow-up lookups rather than by
   * joining them into that SQL, and the choice is deliberate. `overdueIssuesQuery`
   * is shaped column-for-column to the `issue_due` partial index, with an e2e
   * test that EXPLAINs it and fails on a Seq Scan; adding joins would put that
   * plan back in play for a screen that lists at most 500 rows. Instead the
   * tuned query stays byte-identical, and the hydration is two primary-key
   * `IN` lookups over the distinct ids — three indexed queries in total, no
   * N+1, and nothing that can regress the plan the test protects.
   */
  async listOverdue(tx: LibraryTx, orgId: string, now: Date, allowedBranches: string[]): Promise<OverdueIssueItem[]> {
    const rows = await tx.$queryRaw<Array<{ id: string; copyId: string; memberId: string; issuedAt: Date; dueAt: Date; renewCount: number }>>(
      overdueIssuesQuery(orgId, now, allowedBranches),
    );
    if (rows.length === 0) return [];

    const [members, copies] = await Promise.all([
      tx.member.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.memberId))] } },
        select: MEMBER_CARD_SELECT,
      }),
      tx.copy.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.copyId))] } },
        select: { id: true, accessionNumber: true, title: { select: { id: true, title: true } } },
      }),
    ]);

    const memberById = new Map(members.map((m) => [m.id, m]));
    const copyById = new Map(copies.map((c) => [c.id, c]));

    return rows.flatMap((r) => {
      const member = memberById.get(r.memberId);
      const copy = copyById.get(r.copyId);
      // Both are FK-guaranteed to exist, so a miss means RLS hid a row that
      // the issue still points at — a real tenancy fault. Dropping the row is
      // the safe read: it is better to under-report an overdue book than to
      // render half a record from another org.
      if (!member || !copy) return [];
      return [{
        ...r,
        daysOverdue: Math.floor((now.getTime() - r.dueAt.getTime()) / MS_PER_DAY),
        member,
        title: copy.title,
        accessionNumber: copy.accessionNumber,
      }];
    });
  }

  /**
   * Issued / returned / overdue counts, and fines accrued (count + amount),
   * for one calendar day IN THE ORG'S OWN TIMEZONE (`dayRangeForOrg` — see
   * its own doc for why UTC boundaries were wrong). `overdue` is "still
   * outstanding AND past due as of the END of that day" — not merely
   * "overdue right now" — so a historical date reconciles the same way today
   * it will next month: `dueAt < dayEnd AND (returnedAt IS NULL OR
   * returnedAt >= dayEnd)`. `finesAccrued` counts `Fine` rows CREATED that
   * day (this codebase's only fine-creation path is `issues.service.ts`'s
   * late-return flow, kind `OVERDUE`, but this counts every kind — nothing
   * here assumes only `OVERDUE` fines exist).
   *
   * Branch filter: `Issue` filters directly on its own `branchId`; the `Fine`
   * aggregate joins through `issue`, same reasoning/convention as
   * `listFines`/`waive` above (a issue-less fine passes through for every
   * branch-scoped caller, since it has no branch to attribute).
   */
  async dayReport(tx: LibraryTx, orgId: string, query: DayReportQueryDto, allowedBranches: string[]): Promise<DayReport> {
    const { start, end, date: dateStr } = await dayRangeForOrg(tx, orgId, query.date ?? null);
    const branchFilter = allowedBranches.length > 0 ? { branchId: { in: allowedBranches } } : {};

    const [issued, returned, overdue, fineAgg] = await Promise.all([
      tx.issue.count({ where: { orgId, ...branchFilter, issuedAt: { gte: start, lt: end } } }),
      tx.issue.count({ where: { orgId, ...branchFilter, returnedAt: { gte: start, lt: end } } }),
      tx.issue.count({
        where: { orgId, ...branchFilter, dueAt: { lt: end }, OR: [{ returnedAt: null }, { returnedAt: { gte: end } }] },
      }),
      tx.fine.aggregate({
        where: {
          orgId,
          createdAt: { gte: start, lt: end },
          ...(allowedBranches.length > 0
            ? { OR: [{ issueId: null }, { issue: { branchId: { in: allowedBranches } } }] }
            : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      date: dateStr,
      issued,
      returned,
      overdue,
      finesAccrued: { count: fineAgg._count._all, amount: decimalToMoneyString(fineAgg._sum.amount) },
    };
  }
}
