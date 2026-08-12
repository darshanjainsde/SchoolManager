import { apiFetch } from './api';

/**
 * Mirrors `MEMBER_CARD_SELECT` in the API's `members.service.ts` — transcribed
 * from that constant, not recalled. It is deliberately narrow: no phone, no
 * email, no address, no photo. If a field you want isn't here, it is missing
 * on purpose and the API is where that decision gets revisited.
 */
export interface MemberCard {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  memberType: 'STUDENT' | 'TEACHER' | 'EXTERNAL';
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  homeBranchId: string | null;
}

export interface Ctx {
  host: string;
  token: string;
}

export function searchMembers(
  ctx: Ctx,
  q: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<MemberCard[]> {
  const params = new URLSearchParams({ q });
  if (opts.limit) params.set('limit', String(opts.limit));
  return apiFetch<MemberCard[]>(`/circulation/members?${params}`, {
    host: ctx.host,
    token: ctx.token,
    signal: opts.signal,
  });
}

export function memberName(m: Pick<MemberCard, 'firstName' | 'lastName'>): string {
  return `${m.firstName} ${m.lastName}`.trim();
}

/**
 * Initials for the avatar disc. Falls back to the first two characters of
 * whichever name exists, so a member recorded with only one name still gets a
 * disc rather than an empty circle.
 */
export function initials(m: Pick<MemberCard, 'firstName' | 'lastName'>): string {
  const first = m.firstName?.trim() ?? '';
  const last = m.lastName?.trim() ?? '';
  if (first && last) return (first[0] + last[0]).toUpperCase();
  return (first || last).slice(0, 2).toUpperCase() || '·';
}

/** A stable hue per member, so the same person keeps the same disc colour across screens. */
export function memberHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export type MemberTone = 'ok' | 'warn' | 'stop';

/**
 * A suspended member can't borrow and a pending one hasn't been activated —
 * both need to be visible in the picker BEFORE the librarian scans a book,
 * not discovered as a 409 afterwards.
 */
export function statusTone(status: MemberCard['status']): MemberTone {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'PENDING') return 'warn';
  return 'stop';
}
