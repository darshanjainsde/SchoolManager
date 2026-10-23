'use client';
/**
 * Refer & Earn: the promoter's session and API client.
 *
 * A promoter has no refresh cookie — the token is a 30-day bearer token kept
 * in localStorage under `sk_promoter_session`, like the alumni session. It is
 * readable by any script on sckools.com, which is why /earn and /promoter sit
 * behind the hardened CSP in middleware.ts (console-segments.test.ts enforces
 * that). A 401 clears it and sends the person back to the sign-in door.
 */

export const PROMOTER_TOKEN_KEY = 'sk_promoter_session';
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function getPromoterToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(PROMOTER_TOKEN_KEY); } catch { return null; }
}
export function setPromoterToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(PROMOTER_TOKEN_KEY, token);
    else window.localStorage.removeItem(PROMOTER_TOKEN_KEY);
  } catch { /* private mode: the session simply does not persist */ }
}

export class PromoterApiError extends Error {
  status: number;
  code?: string;
  field?: string;
  constructor(status: number, message: string, code?: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** The API's error envelope: `{ code, message, field? }` from ApiError, or Nest's `{ message }`. */
async function errorOf(res: Response): Promise<PromoterApiError> {
  let body: { code?: string; message?: string | string[]; field?: string } = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  const message = Array.isArray(body.message) ? body.message[0] : body.message;
  return new PromoterApiError(res.status, message || (res.status === 429 ? 'Too many tries. Wait a minute.' : `HTTP ${res.status}`), body.code, body.field);
}

export async function promoterFetch<T>(path: string, init: RequestInit = {}, opts: { auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof window !== 'undefined') {
    headers.set('X-Skoolos-Host', window.location.host);
    headers.set('X-Forwarded-Host', window.location.host);
  }
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (opts.auth !== false) {
    const token = getPromoterToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401 && opts.auth !== false) {
    setPromoterToken(null);
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/promoter')) window.location.assign('/earn#signin');
  }
  if (!res.ok) throw await errorOf(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const promoterApi = {
  get: <T>(path: string) => promoterFetch<T>(path),
  post: <T>(path: string, body?: unknown) => promoterFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => promoterFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => promoterFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  /** The two doors before a session exists. */
  public: { post: <T>(path: string, body: unknown) => promoterFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }, { auth: false }) },
};

// ─── Shapes the API answers with (the subset the pages read) ────────────────

export type ReferralStatus = 'LOGGED' | 'ACCEPTED' | 'CONTACTED' | 'DEMO_DONE' | 'PROPOSAL_SENT' | 'WON' | 'LIVE' | 'PAYOUT_DUE' | 'PAID' | 'REJECTED' | 'LOST';
export const STAGE_LABEL: Record<ReferralStatus, string> = {
  LOGGED: 'Logged', ACCEPTED: 'Accepted', CONTACTED: 'Contacted', DEMO_DONE: 'Demo done', PROPOSAL_SENT: 'Proposal sent', WON: 'Won', LIVE: 'Live & paid', PAYOUT_DUE: 'Payout due', PAID: 'Paid', REJECTED: 'Not accepted', LOST: 'Lost',
};
export const STAGE_ORDER: ReferralStatus[] = ['LOGGED', 'ACCEPTED', 'CONTACTED', 'DEMO_DONE', 'PROPOSAL_SENT', 'WON', 'LIVE', 'PAYOUT_DUE', 'PAID'];
export function stageTone(s: ReferralStatus): 'good' | 'bad' | 'warn' | 'info' | 'neutral' {
  if (s === 'PAID' || s === 'PAYOUT_DUE' || s === 'LIVE' || s === 'WON') return 'good';
  if (s === 'REJECTED' || s === 'LOST') return 'bad';
  if (s === 'LOGGED') return 'warn';
  return 'info';
}

export interface PromoterMe {
  id: string; code: string; name: string; email: string | null; phoneE164: string | null; city: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED'; statusReason: string | null;
  who: string | null; expect: string | null; areas: string | null; know: string | null; schoolsInMind: string | null; hasGst: boolean;
  commissionPct: number | null; commissionCapMinor: number | null; commissionNote: string | null; commissionSetAt: string | null; commissionRequestedAt: string | null;
  payeeName: string | null; ifsc: string | null; upi: string | null; gstin: string | null; address: string | null; panMasked: string | null; bankAccountMasked: string | null;
  payoutDetailsAt: string | null; kycVerifiedAt: string | null;
  questionnaireComplete: boolean; payoutDetailsComplete: boolean;
  figures: { referred: number; inProgress: number; live: number; earnedMinor: number; paidMinor: number };
  attributionDays: number; payoutDays: number;
}

export interface PromoterReferral {
  id: string; schoolName: string; city: string; area: string | null; studentsApprox: number | null; board: string | null;
  contactName: string; contactRole: string | null; contactPhone: string; contactEmail: string | null; planInterest: string | null; howKnown: string | null;
  status: ReferralStatus; statusReason: string | null; attributionUntil: string; lapsed: boolean; willEarnMinor: number | null; rateKnown: boolean; viaLink: boolean;
  createdAt: string; updatedAt: string;
  payout: { grossMinor: number; tdsMinor: number; netMinor: number; dueOn: string; status: 'DUE' | 'PAID' | 'ON_HOLD'; paidOn: string | null; utr: string | null } | null;
  events: { actor: 'PROMOTER' | 'OWNER' | 'SYSTEM'; fromStatus: ReferralStatus | null; toStatus: ReferralStatus | null; body: string | null; at: string }[];
}

export interface PromoterPayout {
  id: string; grossMinor: number; tdsMinor: number; netMinor: number; dueOn: string; status: 'DUE' | 'PAID' | 'ON_HOLD'; utr: string | null; paidOn: string | null;
  referral: { schoolName: string; city: string };
}

export const rupees = (minor: number) => `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;
export const when = (iso: string | Date) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
