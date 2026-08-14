import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CopyStatus, type Issue, type Fine, type LibraryTx } from '@library/db';
import { assertBranchInScope } from '../../../common/guards/assert-branch-in-scope';
import { markPresentByTransaction } from '../../periods';
import { loadPolicy } from './policy-loader';
import {
  computeFine,
  evaluateIssue,
  reservedShelfExpiry,
  nextReservationToPromote,
  type IssueDenial,
  type Reservation as PolicyHold,
} from '@library/core';
import type { IssueBookDto, ReturnBookDto } from './dto';

/**
 * `IssueDenial` -> the HTTP exception a circulation-desk caller should see.
 * Split the same way `assertQuota` (policy/quota limit -> 403) and the
 * catalogue's `mapPrismaError` (state conflict -> 409) already split their
 * own error surfaces, rather than inventing a third shape here:
 *   - MEMBER_NOT_ACTIVE / MEMBER_LIMIT_REACHED / OUTSTANDING_FINES_EXCEED_LIMIT
 *     / BRANCH_MISMATCH are all "this member/policy forbids it" -> 403.
 *   - COPY_ON_HOLD_FOR_OTHER / COPY_NOT_AVAILABLE are "the copy's current
 *     state conflicts with this request" -> 409.
 * The machine-readable `reason` rides in the response body alongside the
 * message, so a real desk UI can branch on it without parsing English.
 */
function issueDenialToException(reason: IssueDenial): ConflictException | ForbiddenException {
  const body = { reason, message: issueDenialMessage(reason) };
  switch (reason) {
    case 'COPY_ON_HOLD_FOR_OTHER':
    case 'COPY_NOT_AVAILABLE':
      return new ConflictException(body);
    default:
      return new ForbiddenException(body);
  }
}

function issueDenialMessage(reason: IssueDenial): string {
  switch (reason) {
    case 'MEMBER_NOT_ACTIVE':
      return 'This member is not active and cannot borrow';
    case 'MEMBER_LIMIT_REACHED':
      return "This member has reached their plan's borrowing limit";
    case 'OUTSTANDING_FINES_EXCEED_LIMIT':
      return 'This member owes fines above the outstanding limit';
    case 'BRANCH_MISMATCH':
      return "This copy belongs to a branch other than the member's home branch";
    case 'COPY_ON_HOLD_FOR_OTHER':
      return 'This copy is on the reservation shelf for a different member';
    case 'COPY_NOT_AVAILABLE':
      return 'This copy is not available to issue';
  }
}

/** `Prisma.Decimal | number | null | undefined` -> plain `number`, defaulting a missing aggregate to 0. */
function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}

export interface IssueResult {
  issue: Issue;
  collectedReservationId: string | null;
}

export interface ReturnResult {
  issue: Issue;
  fine: Fine | null;
  /** Non-null when this return promoted the next reservation onto the returned copy. */
  promotedReservationId: string | null;
  copyStatus: CopyStatus;
}

@Injectable()
export class IssuesService {
  /**
   * One transaction (the caller supplies `tx` via `withOrg`): resolve copy
   * by accessionNumber -> load member/policy/open issues/open fine total ->
   * `evaluateIssue` -> create `Issue`, set `Copy.status = ISSUED`, write an
   * `AuditLog` row. If the copy was on the reservation shelf for THIS member, that
   * reservation is marked `COLLECTED` in the same transaction.
   *
   * `dto.memberId` is a client-supplied foreign key — looked up on `tx`
   * (this org's RLS-scoped transaction), never trusted at face value.
   * Postgres FK checks bypass RLS by design, so `tx.issue.create`'s own FK
   * constraint would happily accept another org's member id and produce a
   * Issue that structurally references a row this caller can never see
   * (LIBRARY-TRAPS.md, client-supplied-fk-not-org-checked). Doing the
   * lookup here, on `tx`, closes that and is race-free — a lookup on a
   * separate connection would be a TOCTOU against the write below.
   *
   * `allowedBranches` is the CALLING STAFF USER's branch scope
   * (`LibJwtPayload.branches`), checked against the COPY's own branch after
   * it is loaded — never a branch named in the request, which doesn't exist
   * for this route (`IssueBookDto` carries a accessionNumber and a memberId, no
   * branchId). This is the missing half of the divergence the Phase 1a
   * review found: `evaluateIssue`'s BRANCH_MISMATCH (below) is a different
   * rule entirely — it compares the MEMBER's home branch to the copy, and
   * stays unchanged. An ASSISTANT scoped to branch A must be denied issuing
   * a branch-B copy regardless of the member's own home branch.
   *
   * Concurrency: this method does NOT itself serialize two callers issuing
   * the same accessionNumber — under READ COMMITTED, two transactions that both
   * `BEGIN` before either commits can both read the same "copy is
   * AVAILABLE" snapshot and both reach `tx.issue.create` (trap 3,
   * LIBRARY-TRAPS.md). What actually makes a double-issue impossible is the
   * `issue_one_active_per_copy` partial unique index on `Issue(copyId) WHERE
   * "returnedAt" IS NULL` (Task 4): the loser's `create` raises P2002, which
   * this method turns into a 409 rather than an unhandled 500. An
   * `Idempotency-Key` on the route converges the *response* for retried
   * duplicates, but two genuinely concurrent requests still both reach this
   * method — the index, not the interceptor, is the actual guarantee (see
   * issue-constraints.e2e.spec.ts for the proof, and this module's own
   * circulation-issue-return.e2e.spec.ts for the same proof against the
   * real /circulation/issue route).
   */
  async issue(
    tx: LibraryTx,
    orgId: string,
    dto: IssueBookDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<IssueResult> {
    const copy = await tx.copy.findUnique({ where: { orgId_accessionNumber: { orgId, accessionNumber: dto.accessionNumber } } });
    if (!copy) throw new NotFoundException('Copy not found');
    assertBranchInScope(copy.branchId, allowedBranches);

    const member = await tx.member.findUnique({ where: { id: dto.memberId } });
    if (!member) throw new NotFoundException('Member not found');

    const policy = await loadPolicy(tx, orgId, member.memberType, copy.branchId);

    // Only relevant when the copy is currently RESERVED_SHELF — the READY
    // reservation that put it there is what decides whether THIS member may take
    // it (evaluateIssue's COPY_ON_HOLD_FOR_OTHER / "the reservation IS for them"
    // branch).
    const readyHold =
      copy.status === 'RESERVED_SHELF'
        ? await tx.reservation.findFirst({ where: { readyCopyId: copy.id, status: 'READY' } })
        : null;

    const [openLoans, fineAgg] = await Promise.all([
      tx.issue.count({ where: { memberId: member.id, returnedAt: null } }),
      tx.fine.aggregate({
        where: { memberId: member.id, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { amount: true, paidAmount: true },
      }),
    ]);
    const openFineTotal = decimalToNumber(fineAgg._sum.amount) - decimalToNumber(fineAgg._sum.paidAmount);

    const decision = evaluateIssue(
      policy,
      {
        id: member.id,
        status: member.status,
        // A member with no home branch can never satisfy the branch check
        // below (BRANCH_MISMATCH denies correctly) — '' never equals a real
        // branch id, so this is a safe sentinel rather than a special case.
        homeBranchId: member.homeBranchId ?? '',
      },
      { status: copy.status, branchId: copy.branchId, heldForMemberId: readyHold?.memberId ?? null },
      openLoans,
      openFineTotal,
      now,
    );
    if (!decision.allowed) throw issueDenialToException(decision.reason);

    let issue: Issue;
    try {
      issue = await tx.issue.create({
        data: {
          orgId,
          copyId: copy.id,
          branchId: copy.branchId,
          memberId: member.id,
          dueAt: decision.dueAt,
          issuedByUserId: actorUserId,
          status: 'ACTIVE',
        },
      });
    } catch (err) {
      // issue_one_active_per_copy — see this method's own concurrency doc
      // above. A P2002 here means a concurrent issue on this exact copy won
      // the race between our read and our write.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ reason: 'ALREADY_ISSUED', message: 'This copy already has an active issue' });
      }
      throw err;
    }

    await tx.copy.update({ where: { id: copy.id }, data: { status: 'ISSUED' } });

    let collectedReservationId: string | null = null;
    if (readyHold && readyHold.memberId === member.id) {
      await tx.reservation.update({ where: { id: readyHold.id }, data: { status: 'COLLECTED' } });
      collectedReservationId = readyHold.id;
    }

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.issue',
        entity: 'Issue',
        entityId: issue.id,
        after: { copyId: copy.id, accessionNumber: dto.accessionNumber, memberId: member.id, dueAt: decision.dueAt.toISOString() },
      },
    });

    // Attendance is a BY-PRODUCT of the transaction, never a condition on it:
    // a child who issues a book has self-evidently attended, so the librarian
    // never types their name into a register. Best-effort by design — see
    // markPresentByTransaction — because a failed attendance write must never
    // stop a child borrowing a book.
    await markPresentByTransaction(tx, orgId, issue.memberId, member.classRef, issue.branchId);

    return { issue, collectedReservationId };
  }

  /**
   * One transaction: resolve the active issue for the scanned accessionNumber -> set
   * `returnedAt` -> `computeFine` (creating a `Fine` row only when the
   * amount is > 0) -> promote the title's next pending reservation onto this copy,
   * or set `Copy.status = AVAILABLE` if there is none.
   */
  async returnBook(
    tx: LibraryTx,
    orgId: string,
    dto: ReturnBookDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<ReturnResult> {
    const copy = await tx.copy.findUnique({ where: { orgId_accessionNumber: { orgId, accessionNumber: dto.accessionNumber } } });
    if (!copy) throw new NotFoundException('Copy not found');

    const issue = await tx.issue.findFirst({ where: { copyId: copy.id, returnedAt: null } });
    if (!issue) throw new NotFoundException('No active issue for this copy');
    // Checked against the LOAN's own branchId (the branch it was issued
    // at), not the copy's — they are always equal in this phase (nothing
    // moves a copy between branches after issue), but the issue row is the
    // one this action actually mutates, so that's what a staff user's scope
    // is checked against.
    assertBranchInScope(issue.branchId, allowedBranches);

    // Issue.member is onDelete: Restrict, so this row is guaranteed to exist
    // for any real Issue — this findUnique is for memberType (the fine
    // policy lookup key), not an FK-safety check the way IssueBookDto's
    // memberId lookup above is (that one is client-supplied; this one is
    // read off an already-org-scoped row on the same `tx`).
    const member = await tx.member.findUnique({ where: { id: issue.memberId } });
    if (!member) throw new NotFoundException('Member not found');

    const policy = await loadPolicy(tx, orgId, member.memberType, issue.branchId);
    const { days, amount } = computeFine(policy, issue.dueAt, now);

    const returnedLoan = await tx.issue.update({
      where: { id: issue.id },
      data: { returnedAt: now, returnedByUserId: actorUserId, status: 'RETURNED' },
    });

    let fine: Fine | null = null;
    // "Fines are off by default" was a promise nothing kept: this setting was
    // written by the settings screen and read by no code, so every school
    // charged children from day one. The flag gates only STUDENTS — a teacher
    // is an adult and a different conversation.
    const settings = await tx.librarySettings.findUnique({
      where: { orgId },
      select: { chargeStudentFines: true },
    });
    const finesAllowed = member.memberType !== 'STUDENT' || (settings?.chargeStudentFines ?? false);

    if (amount > 0 && finesAllowed) {
      fine = await tx.fine.create({
        data: {
          orgId,
          memberId: member.id,
          issueId: issue.id,
          kind: 'OVERDUE',
          status: 'OPEN',
          amount: new Prisma.Decimal(amount),
          reason: `${days} day(s) overdue`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.return',
        entity: 'Issue',
        entityId: issue.id,
        after: { copyId: copy.id, accessionNumber: dto.accessionNumber, memberId: member.id, overdueDays: days, fineAmount: amount },
      },
    });

    const promotion = await this.promoteOrRelease(tx, orgId, copy.id, copy.branchId, copy.titleId, actorUserId, now);

    // Deliberately NO attendance marking on return.
    //
    // Returning does not prove the holder was here: "Ma'am, I brought Ravi's
    // book" is a daily occurrence, and marking Ravi present would put a child
    // in the library who is absent from school. A false positive on attendance
    // is far worse than a false negative — the school would believe a missing
    // child was accounted for. Issuing IS unambiguous, because the borrower
    // takes the book themselves, so that is where the mark is made.
    return { issue: returnedLoan, fine, promotedReservationId: promotion.promotedReservationId, copyStatus: promotion.copyStatus };
  }

  /**
   * Task 9: before considering which PENDING reservation to promote, sweeps this
   * title's stale `READY` reservations — ones whose shelf window (`reservedShelfDays`
   * from promotion) has lapsed with nobody collecting them. Locked with
   * `SELECT ... FOR UPDATE` for the same reason `promoteOrRelease`'s PENDING
   * lock below is: two simultaneous returns for the same title must not
   * both decide the same stale reservation needs expiring. A swept reservation's copy
   * reverts to `AVAILABLE` — it is NOT re-promoted onto a PENDING reservation in
   * this same pass; `promoteOrRelease`'s own promotion below is scoped to
   * the copy actually being returned right now (see that method's doc).
   *
   * This is a state-transition write (`READY` -> `EXPIRED`), but it is NOT
   * trap 7 (LIBRARY-TRAPS.md #7): it never runs on a timer. It runs only
   * inside a RETURN, a user-triggered action, for the title that return
   * concerns — exactly the exception `ReservationStatus.EXPIRED`'s own schema doc
   * carves out (a GC-style sweep triggered by real traffic is fine; a
   * scheduler deciding state on its own is not).
   */
  private async sweepExpiredReadyHolds(tx: LibraryTx, orgId: string, titleId: string, actorUserId: string, now: Date): Promise<void> {
    const readyRows = await tx.$queryRaw<Array<{ id: string; readyCopyId: string | null; expiresAt: Date }>>`
      SELECT "id", "readyCopyId", "expiresAt"
      FROM "Reservation"
      WHERE "orgId" = ${orgId}::uuid AND "titleId" = ${titleId}::uuid AND "status" = 'READY'
      FOR UPDATE
    `;

    for (const row of readyRows) {
      // Same boundary as policy.ts's reservationState: expiring AT expiresAt, not only strictly past it.
      if (row.expiresAt.getTime() > now.getTime()) continue;

      await tx.reservation.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
      if (row.readyCopyId) {
        await tx.copy.update({ where: { id: row.readyCopyId }, data: { status: 'AVAILABLE' } });
      }
      await tx.auditLog.create({
        data: {
          orgId,
          actorUserId,
          action: 'circulation.reservation.expire',
          entity: 'Reservation',
          entityId: row.id,
          before: { status: 'READY', expiresAt: row.expiresAt.toISOString() },
          after: { status: 'EXPIRED', releasedCopyId: row.readyCopyId },
        },
      });
    }
  }

  /**
   * Locks the title's PENDING reservations with `SELECT ... FOR UPDATE` so two
   * simultaneous returns for two different copies of the same title cannot
   * both read "reservation X is next" and both promote it (trap 3 — a transaction
   * alone gives atomicity, not mutual exclusion). Whichever transaction's
   * `FOR UPDATE` wins the row lock proceeds; the other blocks until the
   * first commits, then re-reads the now-updated (PENDING -> READY) rows
   * and correctly finds a different reservation, or none.
   *
   * Uses raw SQL because Prisma's query builder has no `FOR UPDATE` clause.
   * Runs on `tx` — the same `withOrg`-scoped transaction as every other read
   * in this method — so RLS still applies to it exactly as it would to a
   * generated query.
   */
  private async promoteOrRelease(
    tx: LibraryTx,
    orgId: string,
    copyId: string,
    branchId: string,
    titleId: string,
    actorUserId: string,
    now: Date,
  ): Promise<{ promotedReservationId: string | null; copyStatus: CopyStatus }> {
    await this.sweepExpiredReadyHolds(tx, orgId, titleId, actorUserId, now);

    const rows = await tx.$queryRaw<Array<{ id: string; memberId: string; queuePosition: number; expiresAt: Date }>>`
      SELECT "id", "memberId", "queuePosition", "expiresAt"
      FROM "Reservation"
      WHERE "orgId" = ${orgId}::uuid AND "titleId" = ${titleId}::uuid AND "status" = 'PENDING'
      ORDER BY "queuePosition" ASC
      FOR UPDATE
    `;

    const candidates: PolicyHold[] = rows.map((r) => ({
      memberId: r.memberId,
      queuePosition: r.queuePosition,
      expiresAt: r.expiresAt,
    }));
    const winner = nextReservationToPromote(candidates, now);

    if (!winner) {
      await tx.copy.update({ where: { id: copyId }, data: { status: 'AVAILABLE' } });
      return { promotedReservationId: null, copyStatus: 'AVAILABLE' };
    }

    const winnerRow = rows.find((r) => r.memberId === winner.memberId && r.queuePosition === winner.queuePosition);
    if (!winnerRow) {
      // Defensive only — `winner` is derived from `candidates`, which is a
      // 1:1 map of `rows`, so this can never actually happen. Kept instead
      // of a non-null assertion so a future refactor that breaks that
      // invariant fails loudly here instead of producing `undefined.id`.
      throw new Error('promoteOrRelease: winning reservation not found among locked rows');
    }

    // The reservation-shelf deadline is a function of the WINNING member's own
    // policy (memberType), not the returning member's — a reservation can be
    // promoted for any member type, and reservedShelfDays is a per-memberType
    // tunable (see CirculationPolicy).
    const holdMember = await tx.member.findUnique({ where: { id: winnerRow.memberId }, select: { memberType: true } });
    if (!holdMember) throw new NotFoundException('Reservation member not found');
    // Branch-specific policy of the BRANCH THE COPY IS AT (not the winning
    // member's home branch) — that copy's branch is what the desk holding it
    // physically operates under.
    const holdPolicy = await loadPolicy(tx, orgId, holdMember.memberType, branchId);
    const expiresAt = reservedShelfExpiry(holdPolicy, now);

    await tx.copy.update({ where: { id: copyId }, data: { status: 'RESERVED_SHELF' } });
    await tx.reservation.update({
      where: { id: winnerRow.id },
      data: { status: 'READY', readyCopyId: copyId, branchId, readyAt: now, expiresAt },
    });

    // Durable record only — nothing drains this table until Phase 4 (see
    // the NotificationOutbox model doc in schema.prisma and the design
    // doc's no-scheduler rule, §6.3). Asserted by the e2e suite as a row,
    // never as "a message was sent".
    await tx.notificationOutbox.create({
      data: {
        orgId,
        channel: 'INAPP',
        templateKey: 'HOLD_READY',
        to: winnerRow.memberId,
        payload: {
          holdId: winnerRow.id,
          titleId,
          copyId,
          memberId: winnerRow.memberId,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    return { promotedReservationId: winnerRow.id, copyStatus: 'RESERVED_SHELF' };
  }
}
