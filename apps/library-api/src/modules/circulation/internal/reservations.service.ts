import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Reservation, type Issue, type LibraryTx } from '@library/db';
import { assertQuota } from '../../plans';
import { assertBranchInScope } from '../../../common/guards/assert-branch-in-scope';
import { loadPolicy } from './policy-loader';
import { evaluateRenew, reservationState, type ReservationStatusValue, type RenewDenial } from './policy';
import type { CreateReservationDto, ListReservationsQueryDto, RenewBookDto } from './dto';
import { MEMBER_CARD_SELECT, type MemberCard } from './members.service';

/**
 * PENDING reservations have no real deadline yet — nothing has been promoted for
 * them, so there is nothing to expire. `Reservation.expiresAt` is NOT NULL (see its
 * schema doc in schema.prisma), so rather than adding a nullable column or a
 * queue-timeout feature this phase doesn't have, a PENDING reservation gets this
 * far-future sentinel instead. 100 years keeps it unambiguously "not a real
 * deadline" for any human or log reading the row, and is always `>` `now`
 * for `nextReservationToPromote`'s (currently vestigial for PENDING — see that
 * function's own doc) live filter, and `policy.ts`'s `reservationState` never
 * reinterprets a PENDING reservation by `expiresAt` at all regardless of its value.
 * The moment a reservation is promoted to READY this is overwritten with the REAL
 * deadline — `reservedShelfExpiry(policy, now)` — in `issues.service.ts`'s
 * `promoteOrRelease`, unchanged from Task 8. This is the ONE place the
 * sentinel is produced; do not re-derive it at another call site.
 */
const PENDING_HOLD_SENTINEL_YEARS = 100;
const MS_PER_DAY = 86_400_000;
function pendingHoldSentinel(now: Date): Date {
  return new Date(now.getTime() + PENDING_HOLD_SENTINEL_YEARS * 365 * MS_PER_DAY);
}

/** `RenewDenial` -> the HTTP exception a circulation-desk caller should see. All three are policy/state denials on the LOAN itself, not a copy-availability conflict — so 403 uniformly, same body shape as `issues.service.ts`'s `issueDenialToException`. */
function renewDenialToException(reason: RenewDenial): ForbiddenException {
  const message =
    reason === 'ALREADY_OVERDUE'
      ? 'This issue is already overdue and must be returned, not renewed'
      : reason === 'RENEW_LIMIT'
        ? 'This issue has reached its renewal limit'
        : 'Another member is waiting on this title — renewing would delay their turn';
  return new ForbiddenException({ reason, message });
}

export interface RenewResult {
  issue: Issue;
}

export interface CreateReservationResult {
  reservation: Reservation;
}

export interface ReservationListItem extends Omit<Reservation, 'status'> {
  /** The EFFECTIVE status (`policy.ts`'s `reservationState`), not necessarily the stored column — see that function's doc. */
  status: ReservationStatusValue;
  /** Hydrated so the queue is readable by a person — see `MEMBER_CARD_SELECT`. */
  member: MemberCard;
  title: { id: string; title: string };
}

@Injectable()
export class ReservationsService {
  /**
   * One transaction: resolve the active issue for the scanned accessionNumber ->
   * load member/policy -> count PENDING reservations on the issue's title ->
   * `evaluateRenew` -> update `Issue.dueAt`/`renewCount`, write an
   * `AuditLog` row. Deliberately counts only `PENDING` reservations (not `READY`):
   * a READY reservation is already tied to a SPECIFIC other copy of this title
   * (`readyCopyId`), so renewing THIS issue doesn't delay that member's
   * fulfillment — only someone still waiting for ANY copy (PENDING) is
   * whose turn a renewal would push back, which is `evaluateRenew`'s own
   * `pendingReservationsOnTitle` parameter name and reasoning (policy.ts).
   */
  async renew(
    tx: LibraryTx,
    orgId: string,
    dto: RenewBookDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<RenewResult> {
    const copy = await tx.copy.findUnique({ where: { orgId_accessionNumber: { orgId, accessionNumber: dto.accessionNumber } } });
    if (!copy) throw new NotFoundException('Copy not found');

    const issue = await tx.issue.findFirst({ where: { copyId: copy.id, returnedAt: null } });
    if (!issue) throw new NotFoundException('No active issue for this copy');
    // Same reasoning as issues.service.ts's returnBook: checked against the
    // LOAN's own branch, the row this action actually mutates.
    assertBranchInScope(issue.branchId, allowedBranches);

    // Same non-FK-lookup reasoning as issues.service.ts's returnBook: Issue.member
    // is onDelete Restrict, and issue.memberId was read off an already
    // org-scoped row on this same tx, not supplied by the client.
    const member = await tx.member.findUnique({ where: { id: issue.memberId } });
    if (!member) throw new NotFoundException('Member not found');

    const policy = await loadPolicy(tx, orgId, member.memberType, issue.branchId);
    const pendingReservationsOnTitle = await tx.reservation.count({ where: { orgId, titleId: copy.titleId, status: 'PENDING' } });

    const decision = evaluateRenew(policy, issue, pendingReservationsOnTitle, now);
    if (!decision.allowed) throw renewDenialToException(decision.reason);

    const updated = await tx.issue.update({
      where: { id: issue.id },
      data: { dueAt: decision.newDueAt, renewCount: { increment: 1 } },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.renew',
        entity: 'Issue',
        entityId: issue.id,
        after: { copyId: copy.id, accessionNumber: dto.accessionNumber, memberId: member.id, newDueAt: decision.newDueAt.toISOString(), renewCount: updated.renewCount },
      },
    });

    return { issue: updated };
  }

  /**
   * One transaction: resolve title/member (both client-supplied FKs, looked
   * up on `tx` — see `dto.ts`'s doc on `CreateReservationDto`) -> `assertQuota` on
   * `maxReservations` (counting this member's own open — `PENDING`/`READY` —
   * reservations, not their total history) -> assign the next `queuePosition`
   * under an advisory lock -> insert the `Reservation` row.
   *
   * Queue-position assignment CANNOT reuse the return flow's `SELECT ...
   * FOR UPDATE` pattern directly: that pattern locks EXISTING rows, so it
   * locks nothing (and therefore serializes nothing) the first time a reservation
   * is placed on a title with zero prior reservations — exactly the
   * txn-scope-is-not-mutual-exclusion trap (LIBRARY-TRAPS.md #3) applied to
   * an aggregate over a possibly-empty set. An advisory lock keyed on
   * `(orgId, titleId)`, acquired BEFORE the `MAX(queuePosition)` read, has
   * no such gap: it blocks a second concurrent `createReservation` for the same
   * title regardless of how many rows currently exist. This is the only
   * call site that locks `(orgId, titleId)` this way and the only call site
   * that calls `assertQuota` in this method, so the fixed
   * quota-lock-then-queue-lock order can never deadlock against itself
   * (assertQuota's own doc: the risk is only cross-call-site inconsistent
   * ordering, not two locks used consistently by one path).
   *
   * Deliberately NOT branch-scope-checked against the caller's
   * `allowedBranches`: a reservation is placed on a Title (org-wide — any branch's
   * copy can fill it) and this method touches no row that has a branch of
   * its own yet, so there is nothing here for `assertBranchInScope` to check
   * against, unlike `issue`/`returnBook`/`renew`, which each load a
   * Copy/Issue row with a real branch. The member's OWN home branch is still
   * used to resolve which `CirculationPolicy` (branch override vs org
   * default) governs their `maxReservations` quota below — that is a policy
   * lookup, not an authorization check.
   */
  async createReservation(tx: LibraryTx, orgId: string, dto: CreateReservationDto, actorUserId: string, now: Date): Promise<CreateReservationResult> {
    const title = await tx.title.findUnique({ where: { id: dto.titleId } });
    if (!title) throw new NotFoundException('Title not found');

    const member = await tx.member.findUnique({ where: { id: dto.memberId } });
    if (!member) throw new NotFoundException('Member not found');

    const policy = await loadPolicy(tx, orgId, member.memberType, member.homeBranchId);
    await assertQuota(
      tx,
      orgId,
      policy.maxReservations,
      (txx) => txx.reservation.count({ where: { orgId, memberId: member.id, status: { in: ['PENDING', 'READY'] } } }),
      `reservations:${member.id}`,
    );

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${dto.titleId}))`;
    // Phase 1a review finding: MAX(queuePosition) must be taken over EVERY
    // reservation this title has ever had, not just the currently PENDING/READY
    // ones. Cancelling (or the copy-issue flow collecting) the reservation that
    // currently reservations the max position SHRINKS the {PENDING,READY} set, so
    // an aggregate scoped to that set alone can recompute a LOWER max and
    // then reissue +1 as a position a terminal (CANCELLED/COLLECTED/EXPIRED)
    // reservation already used. That is never a LIVE collision — the unique index
    // `reservation_one_per_member_title` and this method's own status
    // filtering elsewhere only ever care about currently-open reservations — but it
    // makes `queuePosition` non-monotonic per title, which reads as a
    // duplicate from any UI/report listing a title's reservation HISTORY (console).
    // Scoping the max to ALL statuses makes position numbers a strictly
    // increasing per-title sequence — like a ticket counter — with gaps left
    // by terminal reservations NEVER reused; ordering among live reservations (this
    // service's `listReservations`, `promoteOrRelease`'s PENDING lock/order) is
    // unaffected, since both already filter by status independently and
    // only ever rely on RELATIVE order, never on the numbers being
    // contiguous.
    const agg = await tx.reservation.aggregate({
      where: { orgId, titleId: dto.titleId },
      _max: { queuePosition: true },
    });
    const queuePosition = (agg._max.queuePosition ?? 0) + 1;

    let reservation: Reservation;
    try {
      reservation = await tx.reservation.create({
        data: { orgId, titleId: dto.titleId, memberId: member.id, queuePosition, status: 'PENDING', expiresAt: pendingHoldSentinel(now) },
      });
    } catch (err) {
      // reservation_one_per_member_title — this member already has an open
      // (PENDING or READY) reservation on this title.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ reason: 'ALREADY_HOLDING', message: 'This member already has an open reservation on this title' });
      }
      throw err;
    }

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.reservation.create',
        entity: 'Reservation',
        entityId: reservation.id,
        after: { titleId: dto.titleId, memberId: member.id, queuePosition },
      },
    });

    return { reservation };
  }

  /**
   * Cancels a `PENDING` or `READY` reservation — anything else (`COLLECTED`,
   * `EXPIRED`, already `CANCELLED`) is a 409, not silently accepted. `id` is
   * a client-supplied FK, looked up on `tx` — same reasoning as everywhere
   * else in this module. If the reservation was `READY`, its reserved copy reverts
   * to `AVAILABLE` (nobody is claiming it now) — but the next PENDING reservation
   * is deliberately NOT promoted onto it here: promotion is coupled to a
   * RETURN (`issues.service.ts`'s `promoteOrRelease`), per the brief's
   * "swept opportunistically on the next return" scope; a cancelled READY
   * reservation's copy simply sits AVAILABLE until that copy next circulates.
   *
   * Branch-scope checked only when `reservation.branchId` is actually set — only a
   * READY (or previously-READY) reservation has one (see the Reservation model's own
   * schema doc). A still-PENDING reservation has none, same reasoning as
   * `createReservation` above: cancelling a place in an org-wide queue is not a
   * branch-scoped action.
   */
  async cancelReservation(
    tx: LibraryTx,
    orgId: string,
    holdId: string,
    actorUserId: string,
    allowedBranches: string[],
  ): Promise<{ reservation: Reservation }> {
    const reservation = await tx.reservation.findUnique({ where: { id: holdId } });
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (reservation.branchId) assertBranchInScope(reservation.branchId, allowedBranches);

    if (reservation.status !== 'PENDING' && reservation.status !== 'READY') {
      throw new ConflictException({ reason: 'HOLD_NOT_CANCELLABLE', message: `Cannot cancel a reservation in status ${reservation.status}` });
    }

    const updated = await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'CANCELLED' } });
    if (reservation.status === 'READY' && reservation.readyCopyId) {
      await tx.copy.update({ where: { id: reservation.readyCopyId }, data: { status: 'AVAILABLE' } });
    }

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.reservation.cancel',
        entity: 'Reservation',
        entityId: reservation.id,
        before: { status: reservation.status },
        after: { status: 'CANCELLED' },
      },
    });

    return { reservation: updated };
  }

  /**
   * Lists reservations (optionally filtered by `memberId`/`titleId`/effective
   * `status`), reprojecting each row's status through `policy.ts`'s
   * `reservationState` — a stale `READY` reservation reads as `EXPIRED` here from the
   * moment its shelf window lapses, even though the stored column hasn't
   * been swept yet (that write only happens on the title's next return —
   * trap 7, no scheduler). `status` filtering is applied AFTER that
   * reprojection, in JS, precisely so filtering by `EXPIRED` actually
   * surfaces these not-yet-swept rows.
   *
   * Branch filter: `allowedBranches.length === 0` means "all branches" (same
   * convention as `BranchScopeGuard`/`assertBranchInScope`) — no filter at
   * all. Otherwise a reservation is visible when its OWN `branchId` is one of the
   * caller's branches, OR `branchId` is null (a still-PENDING reservation not yet
   * tied to any branch — see the Reservation model's own schema doc): a
   * branch-scoped desk still needs to see the org-wide queue it may
   * eventually fulfil, it just can't see another branch's ALREADY-PROMOTED
   * reservations.
   */
  async listReservations(tx: LibraryTx, orgId: string, query: ListReservationsQueryDto, now: Date, allowedBranches: string[]): Promise<ReservationListItem[]> {
    const rows = await tx.reservation.findMany({
      where: {
        orgId,
        ...(query.memberId ? { memberId: query.memberId } : {}),
        ...(query.titleId ? { titleId: query.titleId } : {}),
        ...(allowedBranches.length > 0 ? { OR: [{ branchId: null }, { branchId: { in: allowedBranches } }] } : {}),
      },
      orderBy: [{ titleId: 'asc' }, { queuePosition: 'asc' }],
      take: query.limit ?? 50,
      // Hydrated in the same query rather than by the client: a reservations queue
      // showing bare UUIDs cannot be acted on, and one call per row would be
      // an N+1 on a screen that lists 50 by default.
      include: {
        member: { select: MEMBER_CARD_SELECT },
        title: { select: { id: true, title: true } },
      },
    });

    const projected: ReservationListItem[] = rows.map((h) => ({ ...h, status: reservationState(h, now) }));
    return query.status ? projected.filter((h) => h.status === query.status) : projected;
  }
}
