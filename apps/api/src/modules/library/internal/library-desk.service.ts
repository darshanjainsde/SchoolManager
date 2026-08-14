import { Injectable } from '@nestjs/common';
import { withOrg, type LibraryTx } from '@library/db';
import { issue as coreIssue, returnBook as coreReturn, renew as coreRenew } from '@library/core';

/**
 * The counter, as the librarian sees it.
 *
 * READ SIDE ONLY, deliberately. Issue, return, renew and void live in
 * `apps/library-api/src/modules/circulation/`, whose correctness rests on
 * database constraints (`issue_one_active_per_copy`) and a 254-line policy
 * module with its own spec. `apps/api` cannot import them, and writing a
 * second implementation here would produce two divergent answers to "what does
 * this child owe" — which is the failure the whole money design is built to
 * prevent. Those move into a shared package before the counter can write.
 *
 * A read that disagrees is a wrong screen; a write that disagrees is a wrong
 * bill. So the reads ship first and the writes wait for the extraction.
 *
 * EVERY query goes through `withOrg` — the `library_app` role, which is bound
 * by RLS because it is neither the table owner, a superuser, nor `BYPASSRLS`
 * (trap 2: `FORCE ROW LEVEL SECURITY` is not what protects this path).
 * `getLibraryPlatformPrisma()` is `BYPASSRLS` and must never appear in this
 * file; `library-desk.service.spec.ts` asserts that it does not.
 *
 * Responses are BUILT, never returned as raw rows — the same rule
 * `library-me.service.ts` states, and for a sharper reason here: this caller
 * is allowed to see money, so a widened `select` leaks in the other direction
 * (trap 17 — a redaction one join away is not a redaction).
 */

/** A person at the counter. `externalRef` is never on this shape — it is a Sckools `User.id`. */
export interface MemberCard {
  memberId: string;
  /** The borrower number written in the register. The school's own student code where there is one. */
  code: string;
  name: string;
  classRef: string | null;
  memberType: string;
  booksOut: number;
  /** Absent, not zero, when nothing is owed — see `library-me.service.ts`. */
  owed?: number;
}

/** What the number written inside a front cover resolves to. */
export interface CopyCard {
  copyId: string;
  accessionNumber: string;
  title: string;
  author: string | null;
  status: string;
  /** Null when the book is on the shelf. */
  out: {
    issueId: string;
    memberId: string;
    memberName: string;
    classRef: string | null;
    backBy: string;
    /** Negative means late, matching `MyBook.daysLeft`. The UI never re-derives it. */
    daysLeft: number;
  } | null;
}

export interface NotReturnedRow {
  issueId: string;
  memberName: string;
  classRef: string | null;
  title: string;
  accessionNumber: string;
  daysLate: number;
}

export interface DeskDayRow {
  issueId: string;
  kind: 'ISSUED' | 'RETURNED';
  at: string;
  memberName: string;
  title: string;
  accessionNumber: string;
}

/**
 * Explicit transaction bounds for every counter WRITE.
 *
 * `withOrg` otherwise takes Prisma's defaults — `timeout: 5000`, `maxWait:
 * 2000`. Issue is ~12 statements and return ~20, over a pooler, and the
 * library console's own `POST /circulation/issue` passes nothing at all: it
 * has simply not met a slow enough connection yet. Forty children in a
 * 35-minute period is when it would.
 *
 * `maxWait` is the wait for a connection BEFORE the transaction starts;
 * exceeding it surfaces as P2024, which reads like pool exhaustion rather
 * than contention. Options are the FOURTH argument to `withOrg` — the third
 * is the client — so `undefined` is passed deliberately, not by oversight.
 */
const DESK_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

/**
 * The counter has no library user of its own.
 *
 * A Sckools librarian holds a `User` row and no `LibUser` row, and
 * `Issue.issuedByUserId` is a foreign key to `LibUser` — so this must be null
 * or the first issue violates it. Her Sckools id still reaches
 * `AuditLog.actorUserId`, which carries no FK. See the contract on
 * `IssueBookInput` in @library/core.
 */
const NO_LIB_USER = null;

/**
 * Branch scoping is a library-console concept — an org with two campuses,
 * each with its own shelves. Sckools resolves one school to one org, and its
 * guards carry no branch. `[]` is the convention `assertBranchInScope` already
 * uses for "every branch", shared with `BranchScopeGuard`; it is not a bypass
 * written for this caller.
 */
const ALL_BRANCHES: string[] = [];

/** Whole days between two instants, floored toward the past. Mirrors `library-me.service.ts`. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function fullName(m: { firstName: string; lastName: string }): string {
  return `${m.firstName} ${m.lastName}`.trim();
}

@Injectable()
export class LibraryDeskService {
  /**
   * Take a book back. The highest-volume action at any school library, and
   * the reason the counter defaults to it: a return needs no member, just the
   * number written inside the front cover.
   *
   * ONE implementation, called — not copied. `returnBook` lives in
   * @library/core and is the same function the library console runs, so the
   * late charge a parent is asked for cannot differ between the two consoles.
   *
   * The response is BUILT here rather than passed through: `ReturnResult`
   * carries whole `Issue`, `Fine` and `Copy` rows, and a raw fine row on a
   * counter screen is how a rupee figure appears somewhere nobody decided to
   * put one.
   */
  async returnBook(orgId: string, accessionNumber: string, actorUserId: string, now = new Date()) {
    return withOrg(
      orgId,
      async (tx: LibraryTx) => {
        const result = await coreReturn(
          tx,
          orgId,
          { accessionNumber: accessionNumber.trim() },
          actorUserId,
          now,
          ALL_BRANCHES,
          NO_LIB_USER,
        );

        const member = await tx.member.findUnique({
          where: { id: result.issue.memberId },
          select: { firstName: true, lastName: true, classRef: true },
        });
        const copy = await tx.copy.findUnique({
          where: { id: result.issue.copyId },
          select: { accessionNumber: true, title: { select: { title: true } } },
        });

        return {
          issueId: result.issue.id,
          memberName: member ? fullName(member) : '',
          classRef: member?.classRef ?? null,
          title: copy?.title.title ?? '',
          accessionNumber: copy?.accessionNumber ?? accessionNumber,
          // Negative days-left is how every other library shape states
          // lateness; `daysLate` here is its positive mirror, and 0 means it
          // came back in time.
          daysLate: Math.max(0, -daysBetween(now, result.issue.dueAt)),
          // Whether a charge was RECORDED. Never the amount: the counter does
          // not collect, and a figure on a return row is a bill nobody looked
          // at before it was shown.
          fineRecorded: result.fine !== null,
          promotedReservationId: result.promotedReservationId,
        };
      },
      undefined,
      DESK_TX_OPTIONS,
    );
  }

  /**
   * Give a book out.
   *
   * `memberId` arrives from the browser, and a foreign key would NOT catch
   * another org's member: Postgres checks referential integrity with RLS
   * bypassed by design. What catches it is that `coreIssue` loads the member
   * through `tx` — the same transaction, with `app.current_org` set — so a
   * member from another org is invisible and the call fails as "not found"
   * rather than succeeding into the wrong school.
   */
  async issueBook(
    orgId: string,
    accessionNumber: string,
    memberId: string,
    actorUserId: string,
    now = new Date(),
  ) {
    return withOrg(
      orgId,
      async (tx: LibraryTx) => {
        const result = await coreIssue(
          tx,
          orgId,
          { accessionNumber: accessionNumber.trim(), memberId },
          actorUserId,
          now,
          ALL_BRANCHES,
          NO_LIB_USER,
        );

        const member = await tx.member.findUnique({
          where: { id: result.issue.memberId },
          select: { firstName: true, lastName: true, classRef: true },
        });
        const copy = await tx.copy.findUnique({
          where: { id: result.issue.copyId },
          select: { accessionNumber: true, title: { select: { title: true } } },
        });

        return {
          issueId: result.issue.id,
          memberName: member ? fullName(member) : '',
          classRef: member?.classRef ?? null,
          title: copy?.title.title ?? '',
          accessionNumber: copy?.accessionNumber ?? accessionNumber,
          backBy: result.issue.dueAt.toISOString(),
          collectedReservationId: result.collectedReservationId,
        };
      },
      undefined,
      DESK_TX_OPTIONS,
    );
  }

  /** Keep it a little longer. Occasional, and the policy decides whether it may. */
  async renewBook(orgId: string, accessionNumber: string, actorUserId: string, now = new Date()) {
    return withOrg(
      orgId,
      async (tx: LibraryTx) => {
        const result = await coreRenew(
          tx,
          orgId,
          { accessionNumber: accessionNumber.trim() },
          actorUserId,
          now,
          ALL_BRANCHES,
        );
        return {
          issueId: result.issue.id,
          backBy: result.issue.dueAt.toISOString(),
          renewCount: result.issue.renewCount,
        };
      },
      undefined,
      DESK_TX_OPTIONS,
    );
  }

  /**
   * Find the child standing at the counter.
   *
   * Searches name, class and borrower code — what a librarian actually knows
   * ("Aarav, 6-B"), never a library-internal id. Rebuilding the CSV-era
   * experience of looking someone up by `S-2291` inside a search box would
   * undo the reason the roster was folded in at all.
   *
   * `booksOut` and `owed` come back with the person because the two questions
   * that decide whether she can hand over a book are "how many does he have"
   * and "does he owe anything" — a second round trip per child at a counter
   * serving forty in a period is the difference between usable and not.
   */
  async searchMembers(orgId: string, q: string, limit = 20): Promise<MemberCard[]> {
    const term = q.trim();
    if (term.length < 2) return [];

    return withOrg(orgId, async (tx: LibraryTx) => {
      const members = await tx.member.findMany({
        where: {
          orgId,
          status: 'ACTIVE',
          OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { classRef: { contains: term, mode: 'insensitive' } },
            { code: { contains: term, mode: 'insensitive' } },
          ],
        },
        // Explicit projection, not a bare row: `externalRef`, `phone`, `email`
        // and `address` all sit on this model and none of them belong on a
        // counter search result.
        select: {
          id: true,
          code: true,
          firstName: true,
          lastName: true,
          classRef: true,
          memberType: true,
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: Math.min(limit, 50),
      });
      if (members.length === 0) return [];

      const ids = members.map((m) => m.id);

      // Two grouped queries rather than a count per member: forty children in
      // a period, typed one after another, is forty round trips otherwise.
      const [outRows, owedRows] = await Promise.all([
        tx.issue.groupBy({
          by: ['memberId'],
          where: { orgId, memberId: { in: ids }, returnedAt: null },
          _count: { _all: true },
        }),
        tx.fine.groupBy({
          by: ['memberId'],
          where: { orgId, memberId: { in: ids }, status: 'OPEN' },
          _sum: { amount: true },
        }),
      ]);

      const outBy = new Map(outRows.map((r) => [r.memberId, r._count._all]));
      const owedBy = new Map(owedRows.map((r) => [r.memberId, Number(r._sum.amount ?? 0)]));

      return members.map((m) => {
        const owed = owedBy.get(m.id) ?? 0;
        return {
          memberId: m.id,
          code: m.code,
          name: fullName(m),
          classRef: m.classRef,
          memberType: m.memberType,
          booksOut: outBy.get(m.id) ?? 0,
          ...(owed > 0 ? { owed } : {}),
        };
      });
    });
  }

  /**
   * What is this number, and who has it?
   *
   * The question a librarian asks when a book is not where it should be, and
   * the one neither console answers today. `null` means the number is not in
   * the register at all — which is a different answer from "on the shelf" and
   * must stay distinguishable at the counter.
   */
  async lookupCopy(orgId: string, accessionNumber: string, now = new Date()): Promise<CopyCard | null> {
    const number = accessionNumber.trim();
    if (!number) return null;

    return withOrg(orgId, async (tx: LibraryTx) => {
      const copy = await tx.copy.findFirst({
        // `(orgId, accessionNumber)` is unique — the index this rides on.
        where: { orgId, accessionNumber: number },
        select: {
          id: true,
          accessionNumber: true,
          status: true,
          title: {
            select: {
              title: true,
              // NOT `replacementPrice`, and no bare `copies: true` anywhere on
              // this shape. The counter does not price anything; the moment a
              // number a parent pays can appear on a screen nobody deliberately
              // opened, the design in the spec's P3 section is broken.
              authors: { select: { author: { select: { name: true } } } },
            },
          },
        },
      });
      if (!copy) return null;

      const issue = await tx.issue.findFirst({
        where: { orgId, copyId: copy.id, returnedAt: null },
        select: {
          id: true,
          dueAt: true,
          member: { select: { id: true, firstName: true, lastName: true, classRef: true } },
        },
      });

      const authors = copy.title.authors.map((a) => a.author.name).filter(Boolean);

      return {
        copyId: copy.id,
        accessionNumber: copy.accessionNumber,
        title: copy.title.title,
        author: authors.length > 0 ? authors.join(', ') : null,
        status: copy.status,
        out: issue
          ? {
              issueId: issue.id,
              memberId: issue.member.id,
              memberName: fullName(issue.member),
              classRef: issue.member.classRef,
              backBy: issue.dueAt.toISOString(),
              daysLeft: daysBetween(now, issue.dueAt),
            }
          : null,
      };
    });
  }

  /**
   * What has not come back, longest late first.
   *
   * Late is DERIVED here from `dueAt` and `returnedAt IS NULL`, never read
   * from a stored status — the service has no scheduler to maintain one
   * (spec §6.3), and an `OVERDUE` enum value would be wrong every night
   * between midnight and whenever a cron that cannot exist would have run.
   *
   * Unlike the teacher's list this one carries the book number, because she is
   * the person who has to find the book, not the person who has to find the
   * child.
   */
  async notReturned(orgId: string, now = new Date(), limit = 200): Promise<NotReturnedRow[]> {
    return withOrg(orgId, async (tx: LibraryTx) => {
      const rows = await tx.issue.findMany({
        where: { orgId, returnedAt: null, dueAt: { lt: now } },
        select: {
          id: true,
          dueAt: true,
          member: { select: { firstName: true, lastName: true, classRef: true } },
          copy: { select: { accessionNumber: true, title: { select: { title: true } } } },
        },
        orderBy: { dueAt: 'asc' },
        take: limit,
      });

      return rows.map((r) => ({
        issueId: r.id,
        memberName: fullName(r.member),
        classRef: r.member.classRef,
        title: r.copy.title.title,
        accessionNumber: r.copy.accessionNumber,
        daysLate: -daysBetween(now, r.dueAt),
      }));
    });
  }

  /**
   * Everything that crossed the counter today, newest first.
   *
   * The day's work as a list, which is what makes a typo visible while it is
   * still fixable. (The Undo action itself is a write and arrives with the
   * circulation extraction; without this list she cannot even SEE the mistake,
   * which is why the read ships first rather than waiting for its button.)
   *
   * "Today" is resolved IN SQL against `LibraryOrg.timezone`, never from this
   * process's clock — the same expression `fines.service.ts#dayRange` uses,
   * deliberately copied rather than re-derived. Vercel runs in UTC and an
   * Indian school does not: between 18:30 and 24:00 UTC it is already tomorrow
   * in IST, so a UTC "today" showed the desk an empty list every evening and
   * hid the morning's work every night. Two different answers to "what did we
   * do today" inside one product is worse than either answer alone.
   */
  async today(orgId: string, dateStr?: string): Promise<DeskDayRow[]> {
    return withOrg(orgId, async (tx: LibraryTx) => {
      const range = await tx.$queryRaw<Array<{ start: Date; end: Date }>>`
        SELECT
          (COALESCE(${dateStr ?? null}::date, (now() AT TIME ZONE o."timezone")::date))::timestamp
            AT TIME ZONE o."timezone" AS "start",
          ((COALESCE(${dateStr ?? null}::date, (now() AT TIME ZONE o."timezone")::date)) + 1)::timestamp
            AT TIME ZONE o."timezone" AS "end"
        FROM "LibraryOrg" o
        WHERE o."id" = ${orgId}::uuid
      `;
      // No row means the org vanished between the guard resolving it and this
      // query — an empty day is the honest answer, not a 500.
      if (!range[0]) return [];
      const { start: dayStart, end: dayEnd } = range[0];

      const select = {
        id: true,
        issuedAt: true,
        returnedAt: true,
        member: { select: { firstName: true, lastName: true } },
        copy: { select: { accessionNumber: true, title: { select: { title: true } } } },
      };

      const [issued, returned] = await Promise.all([
        tx.issue.findMany({
          where: { orgId, issuedAt: { gte: dayStart, lt: dayEnd } },
          select,
          orderBy: { issuedAt: 'desc' },
        }),
        tx.issue.findMany({
          where: { orgId, returnedAt: { gte: dayStart, lt: dayEnd } },
          select,
          orderBy: { returnedAt: 'desc' },
        }),
      ]);

      const rows: DeskDayRow[] = [
        ...issued.map((r) => ({
          issueId: r.id,
          kind: 'ISSUED' as const,
          at: r.issuedAt.toISOString(),
          memberName: fullName(r.member),
          title: r.copy.title.title,
          accessionNumber: r.copy.accessionNumber,
        })),
        ...returned.map((r) => ({
          issueId: r.id,
          kind: 'RETURNED' as const,
          // Non-null by the `where` above; the cast keeps the shape honest
          // rather than inventing a fallback date that would silently sort
          // wrong if the filter ever changed.
          at: (r.returnedAt as Date).toISOString(),
          memberName: fullName(r.member),
          title: r.copy.title.title,
          accessionNumber: r.copy.accessionNumber,
        })),
      ];

      // One book issued and returned the same day appears twice, on purpose:
      // both events happened, and a list that hides one of them is what makes
      // a librarian stop trusting the day's count.
      return rows.sort((a, b) => b.at.localeCompare(a.at));
    });
  }
}
