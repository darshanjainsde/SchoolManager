/**
 * What a lead is, and the handful of judgements the desk makes about one.
 *
 * A dependency-free module on purpose: both the page and its tests import it,
 * and a component module would drag the whole React graph into a unit test
 * (see `test-import-drags-next-font` in the mistake ledger).
 */

export type EnquiryStage = 'NEW' | 'CONTACTED' | 'VISITED' | 'APPLIED' | 'ENROLLED' | 'LOST' | 'CLOSED';

export interface EnquiryNote {
  id: string;
  kind: 'NOTE' | 'STAGE' | 'SYSTEM';
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface Lead {
  id: string;
  parentName: string;
  phone: string;
  email: string | null;
  gradeInterest: string | null;
  message: string | null;
  status: EnquiryStage;
  followUpAt: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  lostReason: string | null;
  noteCount: number;
  createdAt: string;
}

/** The pipeline, in the order a family moves through it. */
export const PIPELINE: { key: Exclude<EnquiryStage, 'LOST' | 'CLOSED'>; label: string }[] = [
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'VISITED', label: 'Visited' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'ENROLLED', label: 'Enrolled' },
];

export const STAGE_LABEL: Record<EnquiryStage, string> = {
  NEW: 'New', CONTACTED: 'Contacted', VISITED: 'Visited', APPLIED: 'Applied',
  ENROLLED: 'Enrolled', LOST: 'Lost',
  // The old three-state model's word for a finished lead. Existing rows carry
  // it; the desk reads it as lost and never writes it.
  CLOSED: 'Lost',
};

export function stageTone(s: EnquiryStage): 'good' | 'bad' | 'info' | 'neutral' {
  if (s === 'ENROLLED') return 'good';
  if (s === 'LOST' || s === 'CLOSED') return 'bad';
  if (s === 'NEW') return 'info';
  return 'neutral';
}

/** A lead nobody has finished with — the only kind that can be overdue. */
export function isOpen(l: Pick<Lead, 'status'>): boolean {
  return l.status !== 'ENROLLED' && l.status !== 'LOST' && l.status !== 'CLOSED';
}

/** Whole days from today to `iso`, in the school's timezone. Negative = past. */
export function daysUntil(iso: string, today = new Date()): number {
  const due = Date.parse(`${iso.slice(0, 10)}T00:00:00+05:30`);
  const now = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const midnight = Date.parse(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00+05:30`,
  );
  return Math.round((due - midnight) / 86_400_000);
}

export interface DueLabel {
  text: string;
  tone: 'bad' | 'warn' | 'muted';
}

/**
 * What the row says about the next step.
 *
 * "No callback set" is deliberately a state with words rather than an empty
 * cell: an open lead with nothing agreed is how a family gets quietly
 * forgotten, and a blank space says nothing is wrong.
 */
export function dueLabel(l: Pick<Lead, 'status' | 'followUpAt'>, today = new Date()): DueLabel | null {
  if (!isOpen(l)) return null;
  if (!l.followUpAt) return { text: 'no callback set', tone: 'muted' };
  const n = daysUntil(l.followUpAt, today);
  if (n < 0) return { text: `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} overdue`, tone: 'bad' };
  if (n === 0) return { text: 'call today', tone: 'warn' };
  if (n === 1) return { text: 'call tomorrow', tone: 'warn' };
  return { text: `in ${n} days`, tone: 'muted' };
}

export type DeskFilter =
  | 'OPEN' | 'ALL' | 'OVERDUE' | 'TODAY' | 'NODUE'
  | 'NEW' | 'CONTACTED' | 'VISITED' | 'APPLIED' | 'ENROLLED' | 'LOST';

export function matchesFilter(l: Lead, filter: DeskFilter, today = new Date()): boolean {
  switch (filter) {
    case 'ALL': return true;
    case 'OPEN': return isOpen(l);
    case 'OVERDUE': return isOpen(l) && !!l.followUpAt && daysUntil(l.followUpAt, today) < 0;
    case 'TODAY': return isOpen(l) && !!l.followUpAt && daysUntil(l.followUpAt, today) === 0;
    case 'NODUE': return isOpen(l) && !l.followUpAt;
    // A CLOSED row from the old model belongs under Lost, or it is invisible.
    case 'LOST': return l.status === 'LOST' || l.status === 'CLOSED';
    default: return l.status === filter;
  }
}

export function matchesQuery(l: Lead, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, '');
  if (l.parentName.toLowerCase().includes(needle)) return true;
  return digits.length > 0 && l.phone.replace(/\D/g, '').includes(digits);
}

/**
 * The order somebody working the desk wants: what is late, then what is due,
 * then everything else newest-first. Sorting by date-received — the old
 * behaviour — puts the forgotten leads at the bottom, which is where they stay.
 */
export function deskOrder(rows: Lead[], today = new Date()): Lead[] {
  const rank = (l: Lead): number => {
    if (!isOpen(l) || !l.followUpAt) return Number.MAX_SAFE_INTEGER;
    return daysUntil(l.followUpAt, today);
  };
  return [...rows].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export interface DeskCounts {
  overdue: number; today: number; never: number; nodue: number; enrolled: number;
}

export function deskCounts(rows: Lead[], today = new Date()): DeskCounts {
  const open = rows.filter(isOpen);
  return {
    overdue: open.filter((l) => l.followUpAt && daysUntil(l.followUpAt, today) < 0).length,
    today: open.filter((l) => l.followUpAt && daysUntil(l.followUpAt, today) === 0).length,
    never: rows.filter((l) => l.status === 'NEW').length,
    nodue: open.filter((l) => !l.followUpAt).length,
    enrolled: rows.filter((l) => l.status === 'ENROLLED').length,
  };
}

/** `+91 98123 00011` → `+919812300011`, for tel: and wa.me. */
export function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

/** Stable per-name colour, so a family keeps the same tile between visits. */
const AVATARS = ['--sk-cls-1', '--sk-cls-2', '--sk-cls-3', '--sk-cls-4'] as const;
export function avatarVar(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}
