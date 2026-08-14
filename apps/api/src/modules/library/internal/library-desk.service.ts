import { Injectable } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import { emitNotifications } from '../../../common/notifications/notification-inbox';
import { withOrg, type LibraryTx } from '@library/db';
import {
  issue as coreIssue,
  returnBook as coreReturn,
  renew as coreRenew,
  voidIssue as coreVoid,
  recordDamage as coreDamage,
  addBook as coreAddBook,
  liveVisits as coreLiveVisits,
  markAttendance as coreMarkAttendance,
  suggestNextAccessionNumbers,
  type RecordDamageInput,
  type AddBookInput,
} from '@library/core';

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

/** One child on the roster of the class that is in the library now. */
export interface PeriodChild {
  memberId: string;
  /** The borrower number in the register — how she finds him if two share a name. */
  code: string;
  name: string;
  /**
   * THREE states, never a boolean.
   *
   *   `auto` — he borrowed or returned something, so the transaction proves it;
   *   `hand` — she ticked him, because he came and browsed;
   *   `no`   — nobody has said he was here.
   *
   * Collapsing `auto` and `hand` would lose the only signal that separates
   * "attended but borrowed nothing" from "was not here", and it is the reason
   * she ticks five children rather than forty.
   */
  seen: 'auto' | 'hand' | 'no';
  /** Books this child is holding right now, and how many of those are late. */
  holding: number;
  late: number;
}

/** A class that is in the library right now. */
export interface PeriodClass {
  visitId: string;
  classRef: string;
  /** Children on the class list. */
  strength: number;
  /** How many of them have been seen, by either route. */
  present: number;
  roster: PeriodChild[];
}

export interface PeriodNow {
  /** The library's own date, in the ORG's timezone. */
  date: string;
  /**
   * False when this school has no library periods on the timetable AT ALL —
   * which is a setup answer, not an empty one. No class being due right now is
   * the ordinary resting state and must not read the same way.
   */
  periodsConfigured: boolean;
  /** False when this library has turned attendance off; then nothing here is ticked. */
  attendanceOn: boolean;
  classes: PeriodClass[];
  /**
   * The room is over-filled. Null the rest of the time.
   *
   * Surfaced from the same over-capacity condition `createPeriod` warns on when
   * the timetable is built, because that warning is seen once by whoever typed
   * the timetable and never again by the person standing in the full room.
   */
  warning: string | null;
}

/**
 * What the library behaves as before anyone has saved a setting — the same two
 * defaults `PeriodsService.getSettings` falls back to. A read must not create
 * the row (that would make a GET take locks), so the fallback lives here too.
 */
const DEFAULT_CLASS_CAPACITY = 2;

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

/**
 * Narrow the roster's `seen` to the three states the screen knows.
 *
 * `liveVisits` builds it in an object literal, so TypeScript widens it to
 * `string` at the boundary. Anything that is not `auto` or `hand` becomes `no`
 * — the direction that is safe, because §2.6 ranks a false POSITIVE on
 * attendance as far worse than a false negative.
 */
function seenState(seen: string): PeriodChild['seen'] {
  return seen === 'auto' ? 'auto' : seen === 'hand' ? 'hand' : 'no';
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

  /**
   * Add a book and its copies.
   *
   * The whole reason the empty-shelves state can offer a button instead of
   * sending her to a second console: until one book exists, the counter cannot
   * open and the children cannot see a Library tab either.
   */
  async addBook(orgId: string, input: AddBookInput, actorUserId: string) {
    return withOrg(
      orgId,
      (tx: LibraryTx) => coreAddBook(tx, orgId, input, actorUserId),
      undefined,
      DESK_TX_OPTIONS,
    );
  }

  /**
   * What the next numbers would be, if this library numbers plainly.
   *
   * Empty is a real answer — for a fresh register, or for any scheme the
   * suggestion cannot read. She types them instead, which is what she does
   * today anyway.
   */
  async nextNumbers(orgId: string, count: number): Promise<string[]> {
    return withOrg(orgId, (tx: LibraryTx) => suggestNextAccessionNumbers(tx, orgId, count));
  }

  /**
   * Ask a class teacher to chase the books their class has not brought back.
   *
   * THE ONLY MECHANISM IN THIS PRODUCT THAT ACTUALLY RECOVERS A BOOK FROM A
   * TEN-YEAR-OLD. A librarian has no authority over a child; a class teacher
   * does. The standalone console can print this list and can do nothing with
   * it — reaching the teacher is the entire payoff of the library living
   * inside Sckools, because only Sckools knows who teaches which class.
   *
   * NAMES, TITLES AND DAYS. Never an amount, even where fines are on — the
   * same invariant the teacher's own screen already keeps. A staffroom is a
   * public place, and the moment this shows what children owe it stops being a
   * nudge and becomes fee collection, at which point the teacher stops opening
   * it and nothing recovers the books at all.
   *
   * TWO DATABASES, TWO TRANSACTIONS, and deliberately not atomic. The books
   * are in the library database and the inbox is in Sckools'. A nudge that
   * fails to send corrupts nothing — she presses it again. Reaching for a
   * distributed transaction to make a reminder all-or-nothing would be a much
   * larger machine than the thing it protects.
   */
  async nudgeClassTeachers(
    orgId: string,
    schoolId: string,
    classRefs: string[],
    now = new Date(),
  ): Promise<{
    notified: Array<{ classRef: string; teacherName: string; books: number }>;
    unmatched: string[];
    /** The late list was cut short, so these counts are a floor, not a total. */
    countsArePartial: boolean;
  }> {
    const wanted = classRefs.map((c) => c.trim()).filter(Boolean);
    if (wanted.length === 0) return { notified: [], unmatched: [], countsArePartial: false };

    // 1. What is late, per class — from the library database.
    const { rows: late, truncated } = await this.notReturned(orgId, now);
    const byClass = new Map<string, number>();
    for (const row of late) {
      if (!row.classRef || !wanted.includes(row.classRef)) continue;
      byClass.set(row.classRef, (byClass.get(row.classRef) ?? 0) + 1);
    }

    // 2. Who teaches those classes — from Sckools. `classRef` is free text
    //    ("6-B"), and the section is `grade.name` + '-' + `name`; that string
    //    is built the same way `LibraryMeService#myClassNotReturned` builds it,
    //    which is the only reason the two ever match. When the class list is
    //    normalised this join stops being a string comparison.
    const sections = await getPlatformPrisma().classSection.findMany({
      where: { schoolId, classTeacherId: { not: null } },
      select: {
        name: true,
        grade: { select: { name: true } },
        classTeacher: { select: { userId: true, firstName: true, lastName: true } },
      },
    });

    const notified: Array<{ classRef: string; teacherName: string; books: number }> = [];
    const unmatched: string[] = [];
    const recipients = new Map<string, { classRef: string; books: number; teacherName: string }>();

    for (const [classRef, books] of byClass) {
      const section = sections.find((s) => `${s.grade.name}-${s.name}` === classRef);
      const userId = section?.classTeacher?.userId;
      if (!section || !userId) {
        // A class whose teacher is unset, or whose label does not match any
        // section, is reported back rather than silently skipped — she needs
        // to know the nudge did not go anywhere.
        unmatched.push(classRef);
        continue;
      }
      const teacherName = `${section.classTeacher?.firstName ?? ''} ${section.classTeacher?.lastName ?? ''}`.trim();
      recipients.set(userId, { classRef, books, teacherName });
      notified.push({ classRef, teacherName, books });
    }

    // 3. Write the inbox rows — in Sckools' own transaction.
    if (recipients.size > 0) {
      await withTenant(schoolId, async (tx) => {
        for (const [userId, r] of recipients) {
          await emitNotifications(tx, {
            schoolId,
            userIds: [userId],
            kind: 'LIBRARY',
            title:
              r.books === 1
                ? `1 library book not returned in ${r.classRef}`
                : `${r.books} library books not returned in ${r.classRef}`,
            // No amount, and no child named in the title — the list is one tap
            // away on their own screen, where it belongs.
            body: 'A word from you is what brings these back.',
            linkType: 'LIBRARY',
            linkId: null,
          });
        }
      });
    }

    // Reported rather than swallowed: if the late list was truncated, the
    // per-class counts in those messages are a FLOOR. A teacher told "3 books"
    // when it is really 9 stops trusting the number, and then stops reading it.
    return { notified, unmatched, countsArePartial: truncated };
  }

  /**
   * A book came back damaged.
   *
   * Records it and charges nothing — no `Fine`, no amount taken, no rupee
   * figure anywhere in the response. That is what makes it safe for her to
   * note, and a librarian who is not afraid of the button is the only way this
   * column ever holds the truth.
   */
  async recordDamage(orgId: string, input: RecordDamageInput, actorUserId: string, now = new Date()) {
    return withOrg(
      orgId,
      (tx: LibraryTx) => coreDamage(tx, orgId, input, actorUserId, now),
      undefined,
      DESK_TX_OPTIONS,
    );
  }

  /**
   * Undo an issue that should never have happened — a mistyped number, or the
   * wrong child chosen.
   *
   * Daily, and the reason it must exist: without it her only options are to
   * leave a false loan standing against a child, or to "return" a book that was
   * never taken — which fabricates a return in the day report and, once the due
   * date passes, bills a family for a book sitting on the shelf.
   *
   * The reason is required by the route, not optional, because this deletes the
   * issue row: the audit entry is the only record it ever existed.
   */
  async undoIssue(orgId: string, issueId: string, reason: string, actorUserId: string) {
    return withOrg(
      orgId,
      (tx: LibraryTx) => coreVoid(tx, orgId, issueId, reason.trim(), actorUserId),
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
  async notReturned(
    orgId: string,
    now = new Date(),
    limit = 200,
  ): Promise<{ truncated: boolean; rows: NotReturnedRow[] }> {
    return withOrg(orgId, async (tx: LibraryTx) => {
      // One row over the limit, so the caller can tell "exactly 200 late books"
      // from "more than 200, and you are not seeing them all". A truncated list
      // that looks complete is how a school concludes it has 200 books out when
      // it has 900 — and the nudge would quietly skip every class beyond the
      // cut. The extra row is dropped below; only the FLAG survives.
      const rows = await tx.issue.findMany({
        where: { orgId, returnedAt: null, dueAt: { lt: now } },
        select: {
          id: true,
          dueAt: true,
          member: { select: { firstName: true, lastName: true, classRef: true } },
          copy: { select: { accessionNumber: true, title: { select: { title: true } } } },
        },
        orderBy: { dueAt: 'asc' },
        take: limit + 1,
      });

      return {
        // `true` means there are MORE than these — the screen says so rather
        // than presenting a cut list as the whole truth.
        truncated: rows.length > limit,
        rows: rows.slice(0, limit).map((r) => ({
          issueId: r.id,
          memberName: fullName(r.member),
          classRef: r.member.classRef,
          title: r.copy.title.title,
          accessionNumber: r.copy.accessionNumber,
          daysLate: -daysBetween(now, r.dueAt),
        })),
      };
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

  /**
   * The class that is in the library right now, and its roster.
   *
   * A school library runs on the timetable, not on walk-ins: 6-B arrives at
   * 10:40, forty children at once, six to eight times a day. Issuing a book
   * already marks a child present as a by-product, so what is left for her is
   * the few who came and browsed and borrowed nothing — five ticks, not forty.
   *
   * THREE ANSWERS, and the screen must tell them apart:
   *   - classes in the room, with rosters;
   *   - nothing due right now, which is the ordinary resting state of a library
   *     between periods and not an error;
   *   - no library periods on the timetable at all, which is a setup answer and
   *     needs the office, not the librarian. `periodsConfigured` is the only
   *     thing that distinguishes the last two, and no roster query can imply it.
   *
   * `liveVisits` is called, not copied — the same function the library console
   * runs, so the two consoles cannot disagree about who was present.
   *
   * The response is BUILT: `LiveVisitsResult` carries every open loan per child
   * with its title and due date, which is a book list nobody asked for on a tick
   * screen. What survives is the count and how many of those are late.
   */
  async periodNow(orgId: string): Promise<PeriodNow> {
    return withOrg(
      orgId,
      async (tx: LibraryTx) => {
        const live = await coreLiveVisits(tx, orgId, ALL_BRANCHES);

        // A read must not write. `PeriodsService.updateSettings` creates the
        // row; here its absence simply means the library behaves as the
        // defaults describe.
        const settings = await tx.librarySettings.findUnique({
          where: { orgId },
          select: { concurrentClassCapacity: true, recordAttendance: true },
        });
        const capacity = settings?.concurrentClassCapacity ?? DEFAULT_CLASS_CAPACITY;

        // Cheaper than a count, and the question is only ever "any at all?".
        const anyPeriod = await tx.libraryPeriod.findFirst({ where: { orgId }, select: { id: true } });

        const classes: PeriodClass[] = live.visits.map((v) => ({
          visitId: v.id,
          classRef: v.classRef,
          strength: v.strength,
          present: v.present,
          roster: v.roster.map((r) => ({
            memberId: r.id,
            code: r.code,
            name: fullName(r),
            seen: seenState(r.seen),
            holding: r.holding,
            late: r.late,
          })),
        }));

        // THE REAL LIMIT IS SEATS. `concurrentClassCapacity` counts classes
        // because that is what a timetable slot holds, but a room does not fill
        // with classes — it fills with children, and two classes of forty-five
        // over-fill a room that three of twenty would not. So the condition is
        // the one `createPeriod` already warns on, and the sentence states the
        // headcount, which is the number she can act on.
        const children = classes.reduce((n, c) => n + c.strength, 0);
        const warning =
          classes.length > capacity
            ? `${classes.length} classes are in the library at once — ${children} children. It is set to hold ${capacity} at a time. The office builds the timetable; this screen only reports it.`
            : null;

        return {
          date: live.date,
          periodsConfigured: anyPeriod !== null,
          attendanceOn: settings?.recordAttendance ?? true,
          classes,
          warning,
        };
      },
      undefined,
      DESK_TX_OPTIONS,
    );
  }

  /**
   * Tick a child who came and browsed without borrowing — or take the tick back.
   *
   * REVERSIBLE, and that is the requirement rather than a convenience. §2.6
   * ranks a false POSITIVE on attendance as far worse than a false negative: a
   * child marked present who was not there is a register that quietly lies, and
   * the only defence against a mis-tap on a list of forty names is being able
   * to undo it. `present: false` is that undo.
   *
   * A hand tick never downgrades an automatic one — the transaction is the
   * stronger evidence — which `markAttendance` enforces in the upsert.
   */
  async markPresent(orgId: string, visitId: string, memberId: string, present: boolean) {
    return withOrg(
      orgId,
      async (tx: LibraryTx) => {
        const result = await coreMarkAttendance(tx, orgId, visitId, { memberId, present }, ALL_BRANCHES);
        // The member comes back with the answer so the screen can reconcile the
        // row it ticked, rather than assuming the one it sent.
        return { visitId, memberId, present: result.present };
      },
      undefined,
      DESK_TX_OPTIONS,
    );
  }
}
