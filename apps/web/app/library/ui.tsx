'use client';
/**
 * Shared pieces of the librarian portal — payload types mirroring the
 * `/library/*` API, tiny formatting helpers, and the handful of visual
 * atoms every tab uses. Pure data + presentational; no fonts, no fetching
 * (so tests can import from here freely).
 */
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';

// ── API payload shapes (mirror apps/api modules/library) ──

export interface CopyView {
  id: string;
  accessionNo: string;
  status: 'IN' | 'OUT' | 'LOST';
  issueId?: string;
  borrower?: { kind: 'STUDENT' | 'TEACHER'; id: string; name: string; code: string | null };
  dueOn?: string;
}

export interface TitleView {
  id: string;
  title: string;
  author: string;
  shelf: string | null;
  totalCopies: number;
  inCopies: number;
  lostCopies: number;
  earliestBack: string | null;
  copies: CopyView[];
}

export interface BorrowerRef {
  kind: 'STUDENT' | 'TEACHER';
  id: string;
  name: string;
  code: string | null;
  className: string | null;
  classSectionId: string | null;
}

export interface IssueCard {
  id: string;
  accessionNo: string;
  titleId: string;
  title: string;
  author: string;
  borrower: BorrowerRef;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  wasLost: boolean;
  accruedFineRupees: number;
}

export interface MemberHit {
  kind: 'STUDENT' | 'TEACHER';
  id: string;
  name: string;
  code: string | null;
  className: string | null;
  holding: number;
}

export interface MemberCardView {
  borrower: BorrowerRef;
  limit: number;
  holdings: IssueCard[];
  duesRupees: number;
}

export interface DashboardPayload {
  counts: {
    totalCopies: number;
    lostCopies: number;
    totalTitles: number;
    outNow: number;
    dueSoon: number;
    finesCollectedRupees: number;
    finesDueRupees: number;
  };
  outNow: IssueCard[];
  dueSoon: IssueCard[];
  today: string;
}

export interface FineEntry {
  id: string;
  kind: 'FIXED' | 'ACCRUING';
  reason: 'LATE' | 'LOST';
  amountRupees: number;
  title: string;
  accessionNo: string;
  borrower: BorrowerRef & { userId: string | null };
  detail: string;
}

export interface FinesPayload {
  collectedRupees: number;
  dueRupees: number;
  entries: FineEntry[];
}

export interface HallPayload {
  date: string;
  period: { id: string; label: string; startTime: string; endTime: string } | null;
  hall: { capacityClasses: number; inUse: number; nowClasses: { id: string; className: string }[] };
  section: { id: string; name: string; className: string } | null;
  roster: { studentId: string; name: string; rollNo: string | null; status: 'PRESENT' | 'ABSENT' | 'LATE' }[];
  teacherRegister: { taken: boolean; takenBy: string | null; takenAt: string | null };
  savedVisit: { source: 'SYNCED' | 'RETAKEN'; savedAt: string } | null;
  sections: { id: string; className: string }[];
}

export interface LibrarySettingsView {
  hallCapacityClasses: number;
  studentLoanLimit: number;
  teacherLoanLimit: number;
  loanDays: number;
  finePerDayRupees: number;
  graceDays: number;
  lostFeeRupees: number;
  fineTeachers: boolean;
  dueSoonReminders: boolean;
}

export interface ReturnResult {
  issue: IssueCard;
  fineRupees: number;
  fineId: string | null;
}

// ── Helpers ───────────────────────────────────────────────

export function rupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

/** '2026-08-30' → '30 Aug'. */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00+05:30`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

/** The `code` the API put in an error body, or null. */
export function apiErrorCode(e: unknown): string | null {
  if (e instanceof ApiError && e.body && typeof e.body === 'object') {
    const code = (e.body as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Due chip tone from days context. */
export function dueTone(dueOn: string, today: string): 'good' | 'amber' | 'bad' {
  if (dueOn < today) return 'bad';
  const days = Math.round((Date.parse(dueOn) - Date.parse(today)) / 86_400_000);
  return days <= 3 ? 'amber' : 'good';
}

// ── Atoms ─────────────────────────────────────────────────

const PILL_TONES = {
  good: 'bg-[var(--sk-good-tint)] text-[var(--sk-good)]',
  amber: 'bg-[var(--sk-amber-tint)] text-[var(--sk-amber-ink)]',
  bad: 'bg-[var(--sk-bad-tint)] text-[var(--sk-bad)]',
  brand: 'bg-[var(--sk-brand-tint)] text-[var(--sk-brand-2)]',
  muted: 'bg-[var(--sk-bg-2)] text-[var(--sk-ink-3)]',
} as const;

export function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${PILL_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function DuePill({ dueOn, today }: { dueOn: string; today: string }) {
  const tone = dueTone(dueOn, today);
  const label =
    tone === 'bad'
      ? `was due ${fmtDay(dueOn)}`
      : dueOn === today
        ? 'due today'
        : `due ${fmtDay(dueOn)}`;
  return <Pill tone={tone}>{label}</Pill>;
}

export function StatCard({
  label,
  value,
  detail,
  tone = 'ink',
  onClick,
  active,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'ink' | 'amber' | 'good' | 'bad';
  onClick?: () => void;
  active?: boolean;
}) {
  const valueColor = {
    ink: 'text-[var(--sk-ink)]',
    amber: 'text-[var(--sk-amber-ink)]',
    good: 'text-[var(--sk-good)]',
    bad: 'text-[var(--sk-bad)]',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border bg-[var(--sk-card)] p-3 text-left shadow-sm transition-transform ${
        onClick ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default'
      } ${active ? 'border-[var(--sk-brand)] ring-1 ring-[var(--sk-brand)]' : 'border-[var(--sk-line)]'}`}
    >
      <span className="block text-[11px] font-bold uppercase tracking-wide text-[var(--sk-ink-3)]">{label}</span>
      <span className={`mt-0.5 block font-serif text-2xl font-semibold tabular-nums ${valueColor}`} style={{ fontFamily: 'var(--sk-serif)' }}>
        {value}
      </span>
      {detail ? <span className="mt-0.5 block text-[11px] text-[var(--sk-ink-3)]">{detail}</span> : null}
    </button>
  );
}

export function SectionH({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--sk-ink-3)] first:mt-0">
      {children}
    </p>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--sk-line)] bg-[var(--sk-card)] shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="px-4 py-5 text-center text-sm text-[var(--sk-ink-3)]">{children}</div>;
}

/** One row in a drill list: title + meta on the left, pills/actions right. */
export function ListRow({
  primary,
  secondary,
  children,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--sk-line)] px-4 py-2.5 text-sm last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-[var(--sk-ink)]">{primary}</div>
        {secondary ? <div className="truncate text-xs text-[var(--sk-ink-3)]">{secondary}</div> : null}
      </div>
      {children}
    </div>
  );
}
