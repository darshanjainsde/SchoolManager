/**
 * Circulation policy engine. Pure functions only — no database, no Nest, no
 * `new Date()` anywhere in this file. Every "current time" comes in as an
 * explicit `now`/`at` parameter, injected by the caller (a controller reading
 * the wall clock exactly once per request, or a test fixture). This is the
 * single source of truth the API, a future mobile app, and every report must
 * agree on for "can this be issued/renewed," "what does this cost," and
 * "what state is this loan in" — so it is deliberately over-tested rather
 * than trusted to match how libraries work from memory (see
 * `docs/superpowers/LIBRARY-TRAPS.md`, trap 15).
 *
 * No catalogue/circulation DB tables exist yet in this phase (Task 1's
 * schema changes were scoped to `RefreshToken` only) — the `Member`, `Copy`,
 * `Loan`, and `Hold` shapes below are this module's own minimal contract,
 * not a re-export of a Prisma model. `Member.status`'s three values
 * deliberately match the existing `MemberStatus` enum
 * (`packages/library-db/prisma/schema.prisma`) so a future Prisma-backed
 * caller needs no translation layer.
 */

export type IssueDenial =
  | 'MEMBER_NOT_ACTIVE'
  | 'MEMBER_LIMIT_REACHED'
  | 'COPY_NOT_AVAILABLE'
  | 'COPY_ON_HOLD_FOR_OTHER'
  | 'OUTSTANDING_FINES_EXCEED_LIMIT'
  | 'BRANCH_MISMATCH';

export type RenewDenial = 'RENEW_LIMIT' | 'HAS_HOLDS' | 'ALREADY_OVERDUE';

export type LoanState = 'ACTIVE' | 'DUE_SOON' | 'OVERDUE' | 'RETURNED';

export interface Policy {
  maxBooks: number;
  loanDays: number;
  renewLimit: number;
  renewDays: number;
  finePerDay: number;
  /** Days past `dueAt` with zero fine before billing starts. */
  graceDays: number;
  /** `null` = uncapped. */
  maxFine: number | null;
  maxHolds: number;
  holdShelfDays: number;
  /** `null` = no outstanding-fine gate on new issues. */
  maxOutstandingFine: number | null;
}

export interface Member {
  id: string;
  /** Matches `MemberStatus` (`PENDING` | `ACTIVE` | `SUSPENDED`) in the Prisma schema. Only `ACTIVE` may borrow. */
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  homeBranchId: string;
}

export interface Copy {
  status: 'AVAILABLE' | 'ON_LOAN' | 'ON_HOLD_SHELF' | 'LOST' | 'WITHDRAWN' | 'IN_REPAIR';
  branchId: string;
  /** Set only when `status` is `ON_HOLD_SHELF`: which member the shelf hold is reserved for. */
  heldForMemberId?: string | null;
}

export interface Loan {
  dueAt: Date;
  returnedAt: Date | null;
  renewCount: number;
}

export interface Hold {
  memberId: string;
  /** Lower = earlier in the queue. */
  queuePosition: number;
  /** The hold-shelf deadline (see `Policy.holdShelfDays`) — past this, the hold is expired and must be skipped. */
  expiresAt: Date;
}

const MS_PER_DAY = 86_400_000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * How far ahead of `dueAt` a still-active loan is reported as `DUE_SOON`
 * rather than `ACTIVE`. Not a `Policy` field: it drives client-facing
 * reminder UI, not a borrowing/fee rule any org configures, so it lives here
 * as a fixed constant rather than a per-org tunable. Exported so a caller
 * (or a test) can reference the exact value instead of hardcoding a copy of
 * it.
 */
export const DUE_SOON_WINDOW_DAYS = 2;

/**
 * Whether `member` may be issued `copy` right now, and its due date if so.
 *
 * Checks run in a fixed order and stop at the first violation — the reason
 * returned is always the FIRST applicable one below, not an arbitrary pick
 * among several that might simultaneously hold:
 *   1. MEMBER_NOT_ACTIVE — a non-active member fails before anything about
 *      the copy is even considered.
 *   2. MEMBER_LIMIT_REACHED — `openLoans >= maxBooks` (at the limit, not
 *      just over it, is already a denial).
 *   3. OUTSTANDING_FINES_EXCEED_LIMIT — `openFineTotal >= maxOutstandingFine`
 *      (again, AT the cap denies; `null` means no cap).
 *   4. BRANCH_MISMATCH — this org's policy is no inter-branch lending: a
 *      copy may only be issued to a member whose home branch owns it.
 *   5. COPY_ON_HOLD_FOR_OTHER / COPY_NOT_AVAILABLE — a copy reserved on the
 *      hold shelf for a DIFFERENT member is not issuable to this one; the
 *      member the hold IS for may take it (that is what a hold shelf is
 *      for); any other non-`AVAILABLE` status is a flat "not available".
 */
export function evaluateIssue(
  p: Policy,
  member: Member,
  copy: Copy,
  openLoans: number,
  openFineTotal: number,
  now: Date,
): { allowed: true; dueAt: Date } | { allowed: false; reason: IssueDenial } {
  if (member.status !== 'ACTIVE') return { allowed: false, reason: 'MEMBER_NOT_ACTIVE' };
  if (openLoans >= p.maxBooks) return { allowed: false, reason: 'MEMBER_LIMIT_REACHED' };
  if (p.maxOutstandingFine !== null && openFineTotal >= p.maxOutstandingFine) {
    return { allowed: false, reason: 'OUTSTANDING_FINES_EXCEED_LIMIT' };
  }
  if (member.homeBranchId !== copy.branchId) return { allowed: false, reason: 'BRANCH_MISMATCH' };
  if (copy.status === 'ON_HOLD_SHELF') {
    if (copy.heldForMemberId !== member.id) return { allowed: false, reason: 'COPY_ON_HOLD_FOR_OTHER' };
  } else if (copy.status !== 'AVAILABLE') {
    return { allowed: false, reason: 'COPY_NOT_AVAILABLE' };
  }
  return { allowed: true, dueAt: addDays(now, p.loanDays) };
}

/**
 * Whether `loan` may be renewed right now, and its new due date if so.
 *
 *   1. ALREADY_OVERDUE — a loan already past `dueAt` must be returned (or
 *      have its fine settled), never silently extended.
 *   2. RENEW_LIMIT — `loan.renewCount >= renewLimit`.
 *   3. HAS_HOLDS — another member is waiting on this title
 *      (`pendingHoldsOnTitle > 0`); renewing would make them wait longer.
 *
 * The new due date is `renewDays` from `now` (today), not from the old
 * `dueAt` — a renewal extends from when it's actually granted.
 */
export function evaluateRenew(
  p: Policy,
  loan: Loan,
  pendingHoldsOnTitle: number,
  now: Date,
): { allowed: true; newDueAt: Date } | { allowed: false; reason: RenewDenial } {
  if (now.getTime() > loan.dueAt.getTime()) return { allowed: false, reason: 'ALREADY_OVERDUE' };
  if (loan.renewCount >= p.renewLimit) return { allowed: false, reason: 'RENEW_LIMIT' };
  if (pendingHoldsOnTitle > 0) return { allowed: false, reason: 'HAS_HOLDS' };
  return { allowed: true, newDueAt: addDays(now, p.renewDays) };
}

/**
 * The fine owed for a loan due at `dueAt`, evaluated `at` a point in time.
 *
 * `days` is the BILLABLE day count — `floor((at - dueAt) / 1 day)` minus
 * `graceDays`, floored at 0 — not the raw overdue day count. Being overdue
 * by exactly `graceDays` days is fully absorbed by grace (`days: 0, amount:
 * 0`); the day after that is the first billable day. `amount` is
 * `days * finePerDay`, capped at `maxFine` when it is not `null`.
 */
export function computeFine(p: Policy, dueAt: Date, at: Date): { days: number; amount: number } {
  const overdueMs = at.getTime() - dueAt.getTime();
  const overdueDays = overdueMs > 0 ? Math.floor(overdueMs / MS_PER_DAY) : 0;
  const days = Math.max(0, overdueDays - p.graceDays);
  const rawAmount = days * p.finePerDay;
  const amount = p.maxFine !== null ? Math.min(rawAmount, p.maxFine) : rawAmount;
  return { days, amount };
}

/**
 * `RETURNED` whenever `returnedAt` is set (regardless of `now`) — a returned
 * loan's clock stops. Otherwise: `OVERDUE` once `now` is strictly past
 * `dueAt` (AT `dueAt` is not yet overdue), `DUE_SOON` inside
 * `DUE_SOON_WINDOW_DAYS` of `dueAt`, else `ACTIVE`.
 */
export function loanState(loan: Pick<Loan, 'dueAt' | 'returnedAt'>, now: Date): LoanState {
  if (loan.returnedAt !== null) return 'RETURNED';
  if (now.getTime() > loan.dueAt.getTime()) return 'OVERDUE';
  const dueSoonFrom = loan.dueAt.getTime() - DUE_SOON_WINDOW_DAYS * MS_PER_DAY;
  if (now.getTime() >= dueSoonFrom) return 'DUE_SOON';
  return 'ACTIVE';
}

/**
 * The hold that should be promoted next: the lowest `queuePosition` among
 * holds not yet expired (`expiresAt` strictly after `now`), or `null` if
 * `holds` is empty or every hold in it has expired.
 */
export function nextHoldToPromote(holds: Hold[], now: Date): Hold | null {
  const live = holds.filter((h) => h.expiresAt.getTime() > now.getTime());
  if (live.length === 0) return null;
  return live.reduce((best, h) => (h.queuePosition < best.queuePosition ? h : best));
}
