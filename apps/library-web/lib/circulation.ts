import { apiFetch } from './api';
import type { MemberCard } from './members';

/**
 * Transcribed from the API's own `loans.service.ts` return shapes and
 * `dto.ts`, not recalled. Money arrives as a string on some paths and a
 * number on others (Prisma `Decimal.toJSON()` returns a string), so every
 * amount is typed `string | number` and normalised once in `rupees()` —
 * unifying the API's representation is a tracked follow-up, and until it
 * lands the client must not assume either.
 */
export type Money = string | number;

export interface Loan {
  id: string;
  copyId: string;
  memberId: string;
  branchId: string | null;
  issuedAt: string;
  dueAt: string;
  returnedAt: string | null;
  renewCount: number;
  status: 'ACTIVE' | 'RETURNED' | 'LOST';
}

export interface Fine {
  id: string;
  memberId: string;
  loanId: string | null;
  kind: 'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER';
  amount: Money;
  waivedAmount: Money;
  status: 'OPEN' | 'PAID' | 'WAIVED' | 'PARTIAL';
}

export interface IssueResult {
  loan: Loan;
  collectedHoldId: string | null;
}

export interface ReturnResult {
  loan: Loan;
  fine: Fine | null;
  promotedHoldId: string | null;
  copyStatus: 'AVAILABLE' | 'ON_HOLD_SHELF';
}

export interface Ctx {
  host: string;
  token: string;
}

/**
 * A barcode scanner fires twice more often than anyone expects, so every desk
 * write carries an Idempotency-Key. Worth knowing what that does and does not
 * buy: the interceptor converges the RESPONSE, but two genuinely concurrent
 * requests can still both run the handler — what actually prevents a double
 * loan is the `loan_one_active_per_copy` partial unique index in the database.
 */
function key(): string {
  return crypto.randomUUID();
}

export function issue(ctx: Ctx, barcode: string, memberId: string): Promise<IssueResult> {
  return apiFetch<IssueResult>('/circulation/issue', {
    method: 'POST',
    host: ctx.host,
    token: ctx.token,
    idempotencyKey: key(),
    body: JSON.stringify({ barcode, memberId }),
  });
}

export function returnLoan(ctx: Ctx, barcode: string): Promise<ReturnResult> {
  return apiFetch<ReturnResult>('/circulation/return', {
    method: 'POST',
    host: ctx.host,
    token: ctx.token,
    idempotencyKey: key(),
    body: JSON.stringify({ barcode }),
  });
}

export function renew(ctx: Ctx, barcode: string): Promise<{ loan: Loan }> {
  return apiFetch<{ loan: Loan }>('/circulation/renew', {
    method: 'POST',
    host: ctx.host,
    token: ctx.token,
    idempotencyKey: key(),
    body: JSON.stringify({ barcode }),
  });
}

/** Normalises the API's two money representations into one number of rupees. */
export function rupees(m: Money | null | undefined): number {
  if (m === null || m === undefined) return 0;
  return typeof m === 'number' ? m : Number(m);
}

export function formatRupees(m: Money | null | undefined): string {
  return `₹${rupees(m).toFixed(2)}`;
}

/**
 * Whole days until due, negative once overdue. Compared at day granularity
 * rather than by millisecond so "due today" reads as 0 rather than flipping
 * to -1 partway through the afternoon.
 */
export function daysUntil(dueAt: string, now = new Date()): number {
  const due = new Date(dueAt);
  const a = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

export type DueTone = 'ok' | 'soon' | 'over';

/** Mirrors policy.ts's loanState bands so the UI and the engine agree. */
export function dueTone(days: number): DueTone {
  if (days < 0) return 'over';
  if (days <= 3) return 'soon';
  return 'ok';
}

/* ------------------------------------------------------------------
   Desk lists — holds, overdue, fines
   Shapes transcribed from the API's HoldListItem / OverdueLoanItem /
   FineListItem (circulation/internal/{holds,fines}.service.ts).
   ------------------------------------------------------------------ */


export interface TitleRef {
  id: string;
  title: string;
}

export interface HoldRow {
  id: string;
  titleId: string;
  memberId: string;
  queuePosition: number;
  status: 'PENDING' | 'READY' | 'COLLECTED' | 'EXPIRED' | 'CANCELLED';
  readyAt: string | null;
  expiresAt: string;
  member: MemberCard;
  title: TitleRef;
}

export interface OverdueRow {
  id: string;
  copyId: string;
  memberId: string;
  issuedAt: string;
  dueAt: string;
  renewCount: number;
  daysOverdue: number;
  member: MemberCard;
  title: TitleRef;
  barcode: string;
}

export interface FineRow {
  id: string;
  memberId: string;
  loanId: string | null;
  kind: 'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER';
  status: 'OPEN' | 'PAID' | 'WAIVED' | 'PARTIAL';
  amount: Money;
  paidAmount: Money;
  waivedAmount: Money | null;
  createdAt: string;
  member: MemberCard;
  /** Null for a fine raised without a loan behind it (damage, lost item). */
  loan: { copy: { title: TitleRef } } | null;
}

export function listHolds(ctx: Ctx, params: { status?: string; limit?: number } = {}): Promise<HoldRow[]> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.limit) q.set('limit', String(params.limit));
  return apiFetch<HoldRow[]>(`/circulation/holds?${q}`, { host: ctx.host, token: ctx.token });
}

export function listOverdue(ctx: Ctx): Promise<OverdueRow[]> {
  return apiFetch<OverdueRow[]>('/circulation/overdue', { host: ctx.host, token: ctx.token });
}

export function listFines(ctx: Ctx, params: { status?: string; limit?: number } = {}): Promise<FineRow[]> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.limit) q.set('limit', String(params.limit));
  return apiFetch<FineRow[]>(`/circulation/fines?${q}`, { host: ctx.host, token: ctx.token });
}

export function waiveFine(ctx: Ctx, fineId: string, reason: string): Promise<{ fine: FineRow }> {
  return apiFetch<{ fine: FineRow }>(`/circulation/fines/${fineId}/waive`, {
    method: 'POST',
    host: ctx.host,
    token: ctx.token,
    idempotencyKey: key(),
    body: JSON.stringify({ reason }),
  });
}

/** Outstanding balance: what is owed after payments and waivers. */
export function outstanding(f: Pick<FineRow, 'amount' | 'paidAmount' | 'waivedAmount'>): number {
  return rupees(f.amount) - rupees(f.paidAmount) - rupees(f.waivedAmount);
}

export interface DayReport {
  date: string;
  issued: number;
  returned: number;
  overdue: number;
  /** `amount` is a decimal string on this path — see the API's `decimalToMoneyString`. */
  finesAccrued: { count: number; amount: Money };
}

export function dayReport(ctx: Ctx, date?: string): Promise<DayReport> {
  const q = new URLSearchParams();
  if (date) q.set('date', date);
  return apiFetch<DayReport>(`/circulation/day-report?${q}`, { host: ctx.host, token: ctx.token });
}
