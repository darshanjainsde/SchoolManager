import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Hold, type Loan, type LibraryTx } from '@library/db';
import { assertQuota } from '../../plans';
import { assertBranchInScope } from '../../../common/guards/assert-branch-in-scope';
import { loadPolicy } from './policy-loader';
import { evaluateRenew, holdState, type HoldStatusValue, type RenewDenial } from './policy';
import type { CreateHoldDto, ListHoldsQueryDto, RenewLoanDto } from './dto';

/**
 * PENDING holds have no real deadline yet — nothing has been promoted for
 * them, so there is nothing to expire. `Hold.expiresAt` is NOT NULL (see its
 * schema doc in schema.prisma), so rather than adding a nullable column or a
 * queue-timeout feature this phase doesn't have, a PENDING hold gets this
 * far-future sentinel instead. 100 years keeps it unambiguously "not a real
 * deadline" for any human or log reading the row, and is always `>` `now`
 * for `nextHoldToPromote`'s (currently vestigial for PENDING — see that
 * function's own doc) live filter, and `policy.ts`'s `holdState` never
 * reinterprets a PENDING hold by `expiresAt` at all regardless of its value.
 * The moment a hold is promoted to READY this is overwritten with the REAL
 * deadline — `holdShelfExpiry(policy, now)` — in `loans.service.ts`'s
 * `promoteOrRelease`, unchanged from Task 8. This is the ONE place the
 * sentinel is produced; do not re-derive it at another call site.
 */
const PENDING_HOLD_SENTINEL_YEARS = 100;
const MS_PER_DAY = 86_400_000;
function pendingHoldSentinel(now: Date): Date {
  return new Date(now.getTime() + PENDING_HOLD_SENTINEL_YEARS * 365 * MS_PER_DAY);
}

/** `RenewDenial` -> the HTTP exception a circulation-desk caller should see. All three are policy/state denials on the LOAN itself, not a copy-availability conflict — so 403 uniformly, same body shape as `loans.service.ts`'s `issueDenialToException`. */
function renewDenialToException(reason: RenewDenial): ForbiddenException {
  const message =
    reason === 'ALREADY_OVERDUE'
      ? 'This loan is already overdue and must be returned, not renewed'
      : reason === 'RENEW_LIMIT'
        ? 'This loan has reached its renewal limit'
        : 'Another member is waiting on this title — renewing would delay their turn';
  return new ForbiddenException({ reason, message });
}

export interface RenewResult {
  loan: Loan;
}

export interface CreateHoldResult {
  hold: Hold;
}

export interface HoldListItem extends Omit<Hold, 'status'> {
  /** The EFFECTIVE status (`policy.ts`'s `holdState`), not necessarily the stored column — see that function's doc. */
  status: HoldStatusValue;
}

@Injectable()
export class HoldsService {
  /**
   * One transaction: resolve the active loan for the scanned barcode ->
   * load member/policy -> count PENDING holds on the loan's title ->
   * `evaluateRenew` -> update `Loan.dueAt`/`renewCount`, write an
   * `AuditLog` row. Deliberately counts only `PENDING` holds (not `READY`):
   * a READY hold is already tied to a SPECIFIC other copy of this title
   * (`readyCopyId`), so renewing THIS loan doesn't delay that member's
   * fulfillment — only someone still waiting for ANY copy (PENDING) is
   * whose turn a renewal would push back, which is `evaluateRenew`'s own
   * `pendingHoldsOnTitle` parameter name and reasoning (policy.ts).
   */
  async renew(
    tx: LibraryTx,
    orgId: string,
    dto: RenewLoanDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<RenewResult> {
    const copy = await tx.copy.findUnique({ where: { orgId_barcode: { orgId, barcode: dto.barcode } } });
    if (!copy) throw new NotFoundException('Copy not found');

    const loan = await tx.loan.findFirst({ where: { copyId: copy.id, returnedAt: null } });
    if (!loan) throw new NotFoundException('No active loan for this copy');
    // Same reasoning as loans.service.ts's returnLoan: checked against the
    // LOAN's own branch, the row this action actually mutates.
    assertBranchInScope(loan.branchId, allowedBranches);

    // Same non-FK-lookup reasoning as loans.service.ts's returnLoan: Loan.member
    // is onDelete Restrict, and loan.memberId was read off an already
    // org-scoped row on this same tx, not supplied by the client.
    const member = await tx.member.findUnique({ where: { id: loan.memberId } });
    if (!member) throw new NotFoundException('Member not found');

    const policy = await loadPolicy(tx, orgId, member.memberType, loan.branchId);
    const pendingHoldsOnTitle = await tx.hold.count({ where: { orgId, titleId: copy.titleId, status: 'PENDING' } });

    const decision = evaluateRenew(policy, loan, pendingHoldsOnTitle, now);
    if (!decision.allowed) throw renewDenialToException(decision.reason);

    const updated = await tx.loan.update({
      where: { id: loan.id },
      data: { dueAt: decision.newDueAt, renewCount: { increment: 1 } },
    });

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.renew',
        entity: 'Loan',
        entityId: loan.id,
        after: { copyId: copy.id, barcode: dto.barcode, memberId: member.id, newDueAt: decision.newDueAt.toISOString(), renewCount: updated.renewCount },
      },
    });

    return { loan: updated };
  }

  /**
   * One transaction: resolve title/member (both client-supplied FKs, looked
   * up on `tx` — see `dto.ts`'s doc on `CreateHoldDto`) -> `assertQuota` on
   * `maxHolds` (counting this member's own open — `PENDING`/`READY` —
   * holds, not their total history) -> assign the next `queuePosition`
   * under an advisory lock -> insert the `Hold` row.
   *
   * Queue-position assignment CANNOT reuse the return flow's `SELECT ...
   * FOR UPDATE` pattern directly: that pattern locks EXISTING rows, so it
   * locks nothing (and therefore serializes nothing) the first time a hold
   * is placed on a title with zero prior holds — exactly the
   * txn-scope-is-not-mutual-exclusion trap (LIBRARY-TRAPS.md #3) applied to
   * an aggregate over a possibly-empty set. An advisory lock keyed on
   * `(orgId, titleId)`, acquired BEFORE the `MAX(queuePosition)` read, has
   * no such gap: it blocks a second concurrent `createHold` for the same
   * title regardless of how many rows currently exist. This is the only
   * call site that locks `(orgId, titleId)` this way and the only call site
   * that calls `assertQuota` in this method, so the fixed
   * quota-lock-then-queue-lock order can never deadlock against itself
   * (assertQuota's own doc: the risk is only cross-call-site inconsistent
   * ordering, not two locks used consistently by one path).
   *
   * Deliberately NOT branch-scope-checked against the caller's
   * `allowedBranches`: a hold is placed on a Title (org-wide — any branch's
   * copy can fill it) and this method touches no row that has a branch of
   * its own yet, so there is nothing here for `assertBranchInScope` to check
   * against, unlike `issue`/`returnLoan`/`renew`, which each load a
   * Copy/Loan row with a real branch. The member's OWN home branch is still
   * used to resolve which `CirculationPolicy` (branch override vs org
   * default) governs their `maxHolds` quota below — that is a policy
   * lookup, not an authorization check.
   */
  async createHold(tx: LibraryTx, orgId: string, dto: CreateHoldDto, actorUserId: string, now: Date): Promise<CreateHoldResult> {
    const title = await tx.title.findUnique({ where: { id: dto.titleId } });
    if (!title) throw new NotFoundException('Title not found');

    const member = await tx.member.findUnique({ where: { id: dto.memberId } });
    if (!member) throw new NotFoundException('Member not found');

    const policy = await loadPolicy(tx, orgId, member.memberType, member.homeBranchId);
    await assertQuota(
      tx,
      orgId,
      policy.maxHolds,
      (txx) => txx.hold.count({ where: { orgId, memberId: member.id, status: { in: ['PENDING', 'READY'] } } }),
      `holds:${member.id}`,
    );

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${dto.titleId}))`;
    // Phase 1a review finding: MAX(queuePosition) must be taken over EVERY
    // hold this title has ever had, not just the currently PENDING/READY
    // ones. Cancelling (or the copy-issue flow collecting) the hold that
    // currently holds the max position SHRINKS the {PENDING,READY} set, so
    // an aggregate scoped to that set alone can recompute a LOWER max and
    // then reissue +1 as a position a terminal (CANCELLED/COLLECTED/EXPIRED)
    // hold already used. That is never a LIVE collision — the unique index
    // `hold_one_pending_per_member_title` and this method's own status
    // filtering elsewhere only ever care about currently-open holds — but it
    // makes `queuePosition` non-monotonic per title, which reads as a
    // duplicate from any UI/report listing a title's hold HISTORY (console).
    // Scoping the max to ALL statuses makes position numbers a strictly
    // increasing per-title sequence — like a ticket counter — with gaps left
    // by terminal holds NEVER reused; ordering among live holds (this
    // service's `listHolds`, `promoteOrRelease`'s PENDING lock/order) is
    // unaffected, since both already filter by status independently and
    // only ever rely on RELATIVE order, never on the numbers being
    // contiguous.
    const agg = await tx.hold.aggregate({
      where: { orgId, titleId: dto.titleId },
      _max: { queuePosition: true },
    });
    const queuePosition = (agg._max.queuePosition ?? 0) + 1;

    let hold: Hold;
    try {
      hold = await tx.hold.create({
        data: { orgId, titleId: dto.titleId, memberId: member.id, queuePosition, status: 'PENDING', expiresAt: pendingHoldSentinel(now) },
      });
    } catch (err) {
      // hold_one_pending_per_member_title — this member already has an open
      // (PENDING or READY) hold on this title.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ reason: 'ALREADY_HOLDING', message: 'This member already has an open hold on this title' });
      }
      throw err;
    }

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.hold.create',
        entity: 'Hold',
        entityId: hold.id,
        after: { titleId: dto.titleId, memberId: member.id, queuePosition },
      },
    });

    return { hold };
  }

  /**
   * Cancels a `PENDING` or `READY` hold — anything else (`COLLECTED`,
   * `EXPIRED`, already `CANCELLED`) is a 409, not silently accepted. `id` is
   * a client-supplied FK, looked up on `tx` — same reasoning as everywhere
   * else in this module. If the hold was `READY`, its reserved copy reverts
   * to `AVAILABLE` (nobody is claiming it now) — but the next PENDING hold
   * is deliberately NOT promoted onto it here: promotion is coupled to a
   * RETURN (`loans.service.ts`'s `promoteOrRelease`), per the brief's
   * "swept opportunistically on the next return" scope; a cancelled READY
   * hold's copy simply sits AVAILABLE until that copy next circulates.
   *
   * Branch-scope checked only when `hold.branchId` is actually set — only a
   * READY (or previously-READY) hold has one (see the Hold model's own
   * schema doc). A still-PENDING hold has none, same reasoning as
   * `createHold` above: cancelling a place in an org-wide queue is not a
   * branch-scoped action.
   */
  async cancelHold(
    tx: LibraryTx,
    orgId: string,
    holdId: string,
    actorUserId: string,
    allowedBranches: string[],
  ): Promise<{ hold: Hold }> {
    const hold = await tx.hold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException('Hold not found');
    if (hold.branchId) assertBranchInScope(hold.branchId, allowedBranches);

    if (hold.status !== 'PENDING' && hold.status !== 'READY') {
      throw new ConflictException({ reason: 'HOLD_NOT_CANCELLABLE', message: `Cannot cancel a hold in status ${hold.status}` });
    }

    const updated = await tx.hold.update({ where: { id: hold.id }, data: { status: 'CANCELLED' } });
    if (hold.status === 'READY' && hold.readyCopyId) {
      await tx.copy.update({ where: { id: hold.readyCopyId }, data: { status: 'AVAILABLE' } });
    }

    await tx.auditLog.create({
      data: {
        orgId,
        actorUserId,
        action: 'circulation.hold.cancel',
        entity: 'Hold',
        entityId: hold.id,
        before: { status: hold.status },
        after: { status: 'CANCELLED' },
      },
    });

    return { hold: updated };
  }

  /**
   * Lists holds (optionally filtered by `memberId`/`titleId`/effective
   * `status`), reprojecting each row's status through `policy.ts`'s
   * `holdState` — a stale `READY` hold reads as `EXPIRED` here from the
   * moment its shelf window lapses, even though the stored column hasn't
   * been swept yet (that write only happens on the title's next return —
   * trap 7, no scheduler). `status` filtering is applied AFTER that
   * reprojection, in JS, precisely so filtering by `EXPIRED` actually
   * surfaces these not-yet-swept rows.
   *
   * Branch filter: `allowedBranches.length === 0` means "all branches" (same
   * convention as `BranchScopeGuard`/`assertBranchInScope`) — no filter at
   * all. Otherwise a hold is visible when its OWN `branchId` is one of the
   * caller's branches, OR `branchId` is null (a still-PENDING hold not yet
   * tied to any branch — see the Hold model's own schema doc): a
   * branch-scoped desk still needs to see the org-wide queue it may
   * eventually fulfil, it just can't see another branch's ALREADY-PROMOTED
   * holds.
   */
  async listHolds(tx: LibraryTx, orgId: string, query: ListHoldsQueryDto, now: Date, allowedBranches: string[]): Promise<HoldListItem[]> {
    const rows = await tx.hold.findMany({
      where: {
        orgId,
        ...(query.memberId ? { memberId: query.memberId } : {}),
        ...(query.titleId ? { titleId: query.titleId } : {}),
        ...(allowedBranches.length > 0 ? { OR: [{ branchId: null }, { branchId: { in: allowedBranches } }] } : {}),
      },
      orderBy: [{ titleId: 'asc' }, { queuePosition: 'asc' }],
      take: query.limit ?? 50,
    });

    const projected: HoldListItem[] = rows.map((h) => ({ ...h, status: holdState(h, now) }));
    return query.status ? projected.filter((h) => h.status === query.status) : projected;
  }
}
