import { apiFetch } from './api';
import type { ApiCtx } from './session';
import type { Money } from './circulation';

/**
 * Client types transcribed from the API's own return shapes —
 * `lost.service.ts` and `fines.service.ts` — read from those files rather than
 * recalled. A client type written from memory of a shape is the most-repeated
 * mistake in this project's ledger.
 *
 * Money arrives as a decimal STRING on `Fine`-shaped paths (Prisma's
 * `Decimal.toJSON()` is `toString()`) and as a JS number on the aggregate
 * endpoints, which convert with `.toNumber()` before returning. That is why
 * some fields below are `Money` and some are `number`, and it is deliberate
 * rather than sloppy — each one matches what its endpoint actually sends.
 */

/**
 * What a librarian may choose when waiving BY HAND.
 *
 * `BOOK_FOUND` and `REPLACED_IN_KIND` are not here on purpose. Collections
 * excludes those two from "let off" because the school got a book back — so
 * they must only ever be written by the routes where that actually happened.
 * Offering them here would let any waiver be relabelled as costless and
 * disappear from the money screen.
 */
export const WAIVER_REASONS = [
  { code: 'HARDSHIP', label: 'The family cannot pay' },
  { code: 'LIBRARY_ERROR', label: 'Our mistake — wrong child or wrong charge' },
  { code: 'GOODWILL', label: 'Let off as a goodwill gesture' },
  { code: 'WRITTEN_OFF_UNREPLACEABLE', label: 'Out of print — nothing to replace it with' },
] as const;
export type WaiverReasonCode =
  | (typeof WAIVER_REASONS)[number]['code']
  | 'BOOK_FOUND'
  | 'REPLACED_IN_KIND';

/** The two the school lost nothing on — never counted as money let off. */
export const MECHANICAL_REASONS: readonly WaiverReasonCode[] = ['BOOK_FOUND', 'REPLACED_IN_KIND'];

export interface DuesRow {
  memberId: string;
  code: string;
  firstName: string;
  lastName: string;
  memberType: 'STUDENT' | 'TEACHER' | 'EXTERNAL';
  classRef: string | null;
  owed: number;
  fineCount: number;
  kinds: Array<'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER'>;
}

export interface CollectionsReport {
  from: string;
  to: string;
  collected: number;
  /** Money genuinely forgiven. Excludes the mechanical codes — the school lost
   *  nothing when a book was found or replaced, and counting those would make
   *  this figure useless for the only question it is asked. */
  letOff: number;
  clearedInKind: number;
  stillOwed: number;
  membersOwing: number;
  byReason: Array<{ kind: 'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER'; collected: number; owed: number }>;
  byMethod: Array<{ method: 'CASH' | 'UPI' | 'OTHER' | 'UNRECORDED'; collected: number; count: number }>;
}

export interface WaiverLogRow {
  fineId: string;
  member: { id: string; firstName: string; lastName: string; code: string };
  kind: 'OVERDUE' | 'DAMAGE' | 'LOST' | 'OTHER';
  amount: Money;
  reasonCode: WaiverReasonCode | null;
  reason: string | null;
  waivedAt: string | null;
  book: string | null;
  accessionNumber: string | null;
  mechanical: boolean;
}

export interface RefundOwedRow {
  id: string;
  refundOwedAmount: Money | null;
  settledAt: string | null;
  member: { id: string; code: string; firstName: string; lastName: string; classRef: string | null } | null;
  copy: { accessionNumber: string; title: { title: string } };
}

export function listDues(
  ctx: ApiCtx,
  params: { memberType?: string; limit?: number } = {},
): Promise<DuesRow[]> {
  const q = new URLSearchParams();
  if (params.memberType) q.set('memberType', params.memberType);
  if (params.limit) q.set('limit', String(params.limit));
  return apiFetch<DuesRow[]>(`/circulation/dues?${q}`, { host: ctx.host, token: ctx.token });
}

export function getCollections(
  ctx: ApiCtx,
  params: { from?: string; to?: string } = {},
): Promise<CollectionsReport> {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  return apiFetch<CollectionsReport>(`/circulation/collections?${q}`, {
    host: ctx.host,
    token: ctx.token,
  });
}

export function listWaivers(ctx: ApiCtx, limit = 50): Promise<WaiverLogRow[]> {
  return apiFetch<WaiverLogRow[]>(`/circulation/waivers?limit=${limit}`, {
    host: ctx.host,
    token: ctx.token,
  });
}

export function listRefundsOwed(ctx: ApiCtx): Promise<RefundOwedRow[]> {
  return apiFetch<RefundOwedRow[]>('/circulation/lost/refunds-owed', {
    host: ctx.host,
    token: ctx.token,
  });
}
