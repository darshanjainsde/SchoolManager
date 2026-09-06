'use client';
/**
 * Shared pieces of the library — payload types mirroring the `/library/*` API,
 * tiny formatting helpers, and the visual atoms every section uses. Pure data
 * plus presentation; no fonts, no fetching, so tests can import from here
 * freely (see `test-import-drags-next-font` in the mistake ledger).
 *
 * The atoms are thin wrappers over the CONSOLE's own classes — `.sk-kpi`,
 * `.sk-card`, `.sk-pill`, `.sk-row`, `.sk-state` — rather than hand-rolled
 * Tailwind. They used to be hand-rolled, which is why the library read as a
 * different product from Exam Hall next door even though both drew from the
 * same tokens. The component API is unchanged from that version on purpose:
 * a repaint changes pixels, not call sites and not copy.
 */
import { useEffect, useState, type ReactNode } from 'react';
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

/**
 * Holds a typeahead value back until typing pauses. Lived in three section
 * files as three identical copies before this; a search box is the one control
 * every section here has.
 */
export function useDebounced(value: string, ms = 250): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

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

/** Today in the school's timezone, as the API's date strings are written. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Atoms ─────────────────────────────────────────────────

/**
 * The library's tone vocabulary predates `.sk-pill`'s. Callers keep their own
 * words and this maps them, so a repaint never turns into a rename across
 * fifty call sites.
 */
const PILL_TONE = {
  good: 'good',
  amber: 'warn',
  bad: 'bad',
  brand: 'info',
  muted: 'neutral',
} as const;

export function Pill({ tone, children }: { tone: keyof typeof PILL_TONE; children: ReactNode }) {
  return (
    <span className="sk-pill" data-tone={PILL_TONE[tone]}>
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

const KPI_TONE = { ink: undefined, amber: 'warn', good: 'good', bad: 'bad' } as const;

/**
 * A headline figure. `.sk-kpi` is the console's own tile — the same one the
 * dashboard, staff attendance and the leave page use — so the library's row of
 * numbers now lines up with every other tab's.
 */
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
  tone?: keyof typeof KPI_TONE;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <span className="lab">{label}</span>
      <span className="n">{value}</span>
      {detail ? <span className="hint">{detail}</span> : null}
    </>
  );
  if (!onClick) {
    return (
      <div className="sk-kpi" data-tone={KPI_TONE[tone]}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className="sk-kpi" data-tone={KPI_TONE[tone]} aria-pressed={!!active} onClick={onClick}>
      {body}
    </button>
  );
}

export function SectionH({ children }: { children: ReactNode }) {
  return <p className="sk-lab" style={{ marginBottom: 7 }}>{children}</p>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`sk-card ${className}`.trim()}>{children}</div>;
}

/** A card's own header strip — title left, anything else right. */
export function CardHead({ children }: { children: ReactNode }) {
  return <div className="sk-card-h">{children}</div>;
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`sk-card-b ${className}`.trim()}>{children}</div>;
}

/**
 * Empty, loading and "nothing here" states. `.sk-state` is serif italic — the
 * register of a margin note — so the page reads as speaking rather than as
 * broken. Every state gets a real treatment; none of them get `opacity`.
 */
export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="sk-state">{children}</p>;
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
    <div className="sk-row sk-listrow">
      {/* `.sp` IS the text column here — it carries flex:1 and holds .nm/.meta.
          Copied from app/app/alumni/page.tsx rather than invented, so a row in
          the library measures and wraps exactly like a row anywhere else. */}
      <div className="sp">
        <div className="nm">{primary}</div>
        {secondary ? <div className="meta">{secondary}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * The counter's scan field. Mono value, prose placeholder, box-wide focus.
 *
 * `mono` is on by default because the librarian types accession numbers and
 * student codes into most of these, and a column of codes only lines up in a
 * mono face. A field that takes a book TITLE passes `mono={false}` — prose set
 * in mono reads as data entry rather than as words.
 */
export function ScanBox({
  value,
  onChange,
  placeholder,
  label,
  mono = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  mono?: boolean;
}) {
  return (
    <div className="sk-scan">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="6.4" />
        <path d="M15.8 15.8 20.4 20.4" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        style={mono ? undefined : { fontFamily: 'inherit' }}
      />
    </div>
  );
}

/**
 * A chosen reader or book, with the way to un-choose it. Both the counter's
 * columns needed this and both had hand-rolled it.
 */
export function PickedCard({
  title,
  detail,
  serif,
  onClear,
  clearLabel,
  children,
}: {
  title: ReactNode;
  detail?: ReactNode;
  serif?: boolean;
  onClear: () => void;
  clearLabel: string;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div className="sk-wrap-sm" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 720,
                fontSize: 14,
                letterSpacing: '-0.005em',
                fontFamily: serif ? 'var(--sk-serif)' : undefined,
              }}
            >
              {title}
            </div>
            {detail ? <div className="meta">{detail}</div> : null}
          </div>
          <button className="sk-btn" data-size="sm" type="button" aria-label={clearLabel} onClick={onClear}>
            Change
          </button>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}
