import { NotFoundException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import { assertBranchInScope } from '../branch-scope';

/**
 * The library period, as the counter sees it: who is in the room right now,
 * and the tick that says a child came and browsed without borrowing.
 *
 * Moved here from `apps/library-api/src/modules/periods/internal/
 * periods.service.ts` when the librarian's counter inside Sckools needed the
 * same two paths — `apps/api` cannot import that app (`no-library-service-imports`).
 * `PeriodsService` is now a thin delegate, so there is still exactly one
 * implementation and the two consoles cannot disagree about who was present.
 *
 * A PURE MOVE: the queries, the response shapes and the error types are the
 * ones the library console has been running. `markPresentByTransaction` — the
 * automatic half of the same rule — already lives in this package
 * (`attendance.ts`); this is the by-hand half joining it.
 *
 * The DTO classes stayed behind. They are class-validator classes belonging to
 * the HTTP layer, and this package takes structural inputs instead, exactly as
 * `IssueBookInput` does.
 */

/** Today, in the ORG's timezone — never the server's. */
export async function orgToday(tx: LibraryTx, orgId: string): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ d: Date }>>`
    SELECT (now() AT TIME ZONE o."timezone")::date AS d
    FROM "LibraryOrg" o WHERE o."id" = ${orgId}::uuid
  `;
  if (!rows[0]) throw new NotFoundException('Org not found');
  return rows[0].d;
}

/**
 * Who is in the library right now, with the roster for each class: what each
 * child holds, what is late, and whether they have been seen.
 *
 * One query per concern rather than one per child — a 40-child class would
 * otherwise be 40 round trips to paint the screen the counter lives on.
 */
export async function liveVisits(tx: LibraryTx, orgId: string, allowedBranches: string[]) {
  const date = await orgToday(tx, orgId);
  const visits = await tx.classVisit.findMany({
    where: {
      orgId, date, closedAt: null,
      ...(allowedBranches.length > 0 ? { branchId: { in: allowedBranches } } : {}),
    },
    include: { attendance: { select: { memberId: true, auto: true } } },
    orderBy: { openedAt: 'asc' },
  });
  if (visits.length === 0) return { date: date.toISOString().slice(0, 10), visits: [] };

  const classRefs = visits.map((v) => v.classRef);
  const members = await tx.member.findMany({
    where: { orgId, classRef: { in: classRefs } },
    select: { id: true, code: true, firstName: true, lastName: true, classRef: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const open = await tx.issue.findMany({
    where: { orgId, returnedAt: null, memberId: { in: members.map((m) => m.id) } },
    select: { memberId: true, dueAt: true, copy: { select: { accessionNumber: true, title: { select: { title: true } } } } },
  });

  const now = Date.now();
  const byMember = new Map<string, typeof open>();
  for (const i of open) {
    const list = byMember.get(i.memberId) ?? [];
    list.push(i);
    byMember.set(i.memberId, list);
  }

  return {
    date: date.toISOString().slice(0, 10),
    visits: visits.map((v) => {
      const seen = new Map(v.attendance.map((a) => [a.memberId, a.auto]));
      const roster = members
        .filter((m) => m.classRef === v.classRef)
        .map((m) => {
          const held = byMember.get(m.id) ?? [];
          const late = held.filter((h) => h.dueAt.getTime() < now).length;
          return {
            id: m.id, code: m.code, firstName: m.firstName, lastName: m.lastName,
            // 'auto' is the load-bearing distinction: it separates "attended
            // but borrowed nothing" from "was not here".
            seen: seen.has(m.id) ? (seen.get(m.id) ? 'auto' : 'hand') : 'no',
            holding: held.length,
            late,
            books: held.map((h) => ({ title: h.copy.title.title, accessionNumber: h.copy.accessionNumber, dueAt: h.dueAt })),
          };
        });
      return {
        id: v.id, classRef: v.classRef, branchId: v.branchId, openedAt: v.openedAt,
        strength: roster.length,
        present: roster.filter((r) => r.seen !== 'no').length,
        roster,
      };
    }),
  };
}

/**
 * Derived rather than declared: the shape is what the mapping above actually
 * produces, so a consumer's type cannot drift from the response.
 */
export type LiveVisitsResult = Awaited<ReturnType<typeof liveVisits>>;

/**
 * The by-hand tick.
 *
 * `present: false` is not an afterthought — §2.6 ranks a false POSITIVE on
 * attendance as far worse than a false negative, which only holds if a
 * mis-tapped tick can be taken back.
 */
export interface MarkAttendanceInput {
  memberId: string;
  /** Absent means "untick" — a librarian correcting a mis-tap must be able to undo it. */
  present?: boolean;
}

/** Tick or untick by hand. The auto rows are written by circulation, not here. */
export async function markAttendance(
  tx: LibraryTx,
  orgId: string,
  visitId: string,
  input: MarkAttendanceInput,
  allowedBranches: string[],
) {
  const visit = await tx.classVisit.findFirst({ where: { id: visitId, orgId }, select: { id: true, branchId: true } });
  if (!visit) throw new NotFoundException('Visit not found');
  assertBranchInScope(visit.branchId, allowedBranches);

  const member = await tx.member.findFirst({ where: { id: input.memberId, orgId }, select: { id: true } });
  if (!member) throw new NotFoundException('Member not found');

  if (input.present === false) {
    await tx.visitAttendance.deleteMany({ where: { visitId, memberId: input.memberId } });
    return { present: false };
  }
  await tx.visitAttendance.upsert({
    where: { visitId_memberId: { visitId, memberId: input.memberId } },
    // A hand tick never downgrades an automatic one: the transaction is the
    // stronger evidence and should survive a stray click.
    update: {},
    create: { orgId, visitId, memberId: input.memberId, auto: false },
  });
  return { present: true };
}
