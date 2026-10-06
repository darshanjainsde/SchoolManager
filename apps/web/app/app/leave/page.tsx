'use client';
import { useState, type CSSProperties, type FocusEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock } from 'lucide-react';
import type { LeavePendingContext } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { ApiError } from '@/lib/api';
import { useHost } from '@/components/use-host';
import { Cell, Row, RowList, RowTitle } from '@/components/ui/kit';
import { OWN_LEAVE_HINT, isDecidedElsewhere, isOwnLeave, leaveSpan, refreshLeaveDesk } from '@/lib/leave-desk';

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaveType = 'SICK' | 'CASUAL' | 'EARNED' | 'UNPAID' | 'OTHER';
type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** Dates arrive as ISO strings over the wire even though the API types them as Date. */
interface LeaveApplication {
  id: string;
  teacherId: string;
  teacherName: string;
  /** The applicant's own login (Teacher.userId / Staff.userId) — null when they have none. */
  personUserId?: string | null;
  type: LeaveType;
  startDate: string;
  endDate: string;
  /** A half day is one date; its half ('AM' | 'PM') is null on an old application. */
  halfDay?: boolean;
  halfDayPart?: 'AM' | 'PM' | null;
  reason: string | null;
  status: LeaveStatus;
  createdAt: string;
}

interface CoverageGap {
  id: string;
  date: string;
  classSectionId: string;
  classSectionName: string;
  periodId: string;
  periodLabel: string;
  originalTeacherName: string;
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
  /** When the substitute tapped "Got it" (ISO) — null until they do. */
  acknowledgedAt: string | null;
}

/** What `GET /manage/substitution/:id/candidates` returns — freeTeachersFor, ranked. */
interface CoverCandidate {
  id: string;
  name: string;
  teachesSubject: boolean;
  coversThatDay: number;
}

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  SICK: 'Sick leave',
  CASUAL: 'Casual leave',
  EARNED: 'Earned leave',
  UNPAID: 'Unpaid leave',
  OTHER: 'Other',
};

// ── Date helpers ──────────────────────────────────────────────────────────────
// Plain date math, UTC-anchored to match the API's `@db.Date` columns (see
// `apps/api/.../internal/leave-dates.ts`) — never shifts with the browser's
// local timezone.

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toDateStr(iso: string): string {
  return iso.slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "8:10 am", in the school's time. */
function seenAt(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * A 409 on a cover means the server's picture moved under this one: someone
 * else filled the gap, or the teacher stopped being free. The API's sentence
 * says which; the page shows it as it is and fetches the picture again.
 */
function isConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

// ── Themed field styles (mirrors classes/availability pages) ────────────────

const fieldStyle: CSSProperties = {
  display: 'block',
  border: '1px solid var(--sk-line-2)',
  borderRadius: 10,
  padding: '8px 10px',
  background: 'var(--sk-card)',
  color: 'var(--sk-ink)',
  fontSize: 13,
  fontFamily: 'inherit',
  transition: 'border-color 0.12s, box-shadow 0.12s',
};

function ringFocus(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-brand)';
  e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--sk-brand) 18%, transparent)';
}
function ringBlur(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-line-2)';
  e.currentTarget.style.boxShadow = 'none';
}

/* A select sizes itself to its LONGEST option ("Rajeshwari Balasubramanian ·
   2 covers that day"), so in a grid track it must be told it may shrink. */
const pickerStyle: CSSProperties = { ...fieldStyle, width: '100%', minWidth: 0, boxSizing: 'border-box', minHeight: 36 };

/**
 * One gap's picker. It asks the server who is free — freeTeachersFor, the
 * same answer WhatsApp and assign() use — and only when somebody opens it, so
 * a week with forty gaps costs nothing until a gap is being filled.
 */
function CoverPicker({ gap, disabled, onPick }: { gap: CoverageGap; disabled: boolean; onPick: (teacherId: string) => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [open, setOpen] = useState(false);
  const candidates = useQuery({
    queryKey: ['a-cover-candidates', gap.id],
    enabled: !!host && open,
    queryFn: () => api.get<CoverCandidate[]>(`/manage/substitution/${gap.id}/candidates`),
  });
  const options = candidates.data ?? [];
  const keepCurrent = !!gap.substituteTeacherId && !options.some((c) => c.id === gap.substituteTeacherId);
  const opening = () => {
    setOpen(true);
    // A failed answer is asked again the next time the picker is opened.
    if (candidates.isError) void candidates.refetch();
  };
  const placeholder = !open
    ? 'Pick a free teacher…'
    : candidates.isError
      ? 'Could not load who is free — open again'
      : candidates.isPending
        ? 'Finding who is free…'
        : options.length === 0
          ? 'Nobody is free that period'
          : 'Pick a free teacher…';
  return (
    <select
      aria-label={`Substitute for ${gap.classSectionName}, ${gap.periodLabel}, ${formatDate(gap.date)}`}
      style={pickerStyle}
      onFocus={(e) => {
        ringFocus(e);
        opening();
      }}
      onMouseDown={opening}
      onBlur={ringBlur}
      value={gap.substituteTeacherId ?? ''}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {/* The current substitute stays selectable even if a later change made them busy. */}
      {keepCurrent ? <option value={gap.substituteTeacherId!}>{gap.substituteTeacherName ?? 'Assigned teacher'}</option> : null}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.teachesSubject ? ' · teaches this subject' : c.coversThatDay > 0 ? ` · ${c.coversThatDay} cover${c.coversThatDay === 1 ? '' : 's'} that day` : ''}
        </option>
      ))}
    </select>
  );
}

/**
 * COVERAGE IS A TAB, NOT THE BOTTOM OF THE PAGE.
 *
 * It used to sit under BOTH leave lists, so a week with thirty leaves put the
 * classes with nobody in front of them a full screen below the fold — the one
 * thing an admin opens this desk to fix was the hardest thing to reach. The
 * three are the same desk at the same height now, and the count of uncovered
 * classes rides its tab so it can be read without opening it.
 */
const LEAVE_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'coverage', label: 'Coverage' },
] as const;
type LeaveTab = (typeof LEAVE_TABS)[number]['id'];

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminLeavePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [range, setRange] = useState({ from: todayIso(), to: addDaysIso(todayIso(), 30) });

  // Leave application id → the outcome just chosen, so the stamp has something
  // to land on while the list refetches. Presentational only; the toast and
  // the reloaded lists are the record. See /app/requests for the full note —
  // the two desks share the gesture because they share the decision.
  const [decided, setDecided] = useState<Record<string, 'approved' | 'rejected'>>({});

  // Pending opens first: it is the decision actually waiting on the admin.
  const [tab, setTab] = useState<LeaveTab>('pending');

  const pending = useQuery({
    queryKey: ['a-leave-pending'],
    enabled: !!host,
    queryFn: () => api.get<LeaveApplication[]>('/manage/leave?status=PENDING'),
  });

  // Who is looking — the layout's own cache entry, so this costs no request.
  const me = useQuery({
    queryKey: ['me', host],
    enabled: !!host,
    staleTime: 5 * 60_000,
    queryFn: () => api.get<{ userId?: string }>('/auth/me'),
  });
  const viewerUserId = me.data?.userId ?? null;

  const approved = useQuery({
    queryKey: ['a-leave-approved'],
    enabled: !!host,
    queryFn: () => api.get<LeaveApplication[]>('/manage/leave?status=APPROVED'),
  });

  // {requestedDays, remaining} per pending application — the overshoot
  // warning an admin sees BEFORE approving into a negative balance.
  const pendingContext = useQuery({
    queryKey: ['a-leave-pending-context'],
    enabled: !!host,
    queryFn: () => api.get<LeavePendingContext>('/manage/leave-policy/pending-context'),
  });

  const coverage = useQuery({
    queryKey: ['a-leave-coverage', range.from, range.to],
    enabled: !!host && !!range.from && !!range.to,
    queryFn: () =>
      api.get<CoverageGap[]>(
        `/manage/leave/coverage?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
  });

  const approve = useMutation({
    mutationFn: (app: LeaveApplication) => api.post<{ gaps: number }>(`/manage/leave/${app.id}/approve`),
    onSuccess: (result, app) => {
      setDecided((d) => ({ ...d, [app.id]: 'approved' }));
      toast.success(
        result.gaps > 0
          ? `Approved — ${result.gaps} coverage ${result.gaps === 1 ? 'gap needs' : 'gaps need'} a substitute.`
          : 'Approved — no scheduled classes to cover on those dates.',
      );
      void qc.invalidateQueries({ queryKey: ['a-leave-pending'] });
      void qc.invalidateQueries({ queryKey: ['a-leave-approved'] });
      void qc.invalidateQueries({ queryKey: ['a-leave-pending-context'] });
      setRange({ from: toDateStr(app.startDate), to: toDateStr(app.endDate) });
      void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      // 409: another desk decided it first — refetch so the row leaves Pending.
      if (isDecidedElsewhere(e)) refreshLeaveDesk(qc);
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/manage/leave/${id}/reject`),
    onSuccess: (_result, id) => {
      setDecided((d) => ({ ...d, [id]: 'rejected' }));
      toast.success('Application rejected.');
      void qc.invalidateQueries({ queryKey: ['a-leave-pending'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      if (isDecidedElsewhere(e)) refreshLeaveDesk(qc);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post<{ status: string; restoredDates: number }>(`/manage/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success('Leave cancelled — classes and attendance restored.');
      void qc.invalidateQueries({ queryKey: ['a-leave-pending'] });
      void qc.invalidateQueries({ queryKey: ['a-leave-approved'] });
      void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
      void qc.invalidateQueries({ queryKey: ['a-cover-candidates'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // A pick changes who is free for every other gap that period, so both the
  // gaps and every picker's answer are asked again — after a success, and
  // after a 409, so a stale picker never offers a teacher who is taken.
  const refreshCover = () => {
    void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
    void qc.invalidateQueries({ queryKey: ['a-cover-candidates'] });
  };
  const coverError = (e: Error) => {
    toast.error(e.message);
    if (isConflict(e)) refreshCover();
  };

  function onCancel(app: LeaveApplication) {
    if (!window.confirm(`Cancel ${app.teacherName}'s leave? Their classes will be restored.`)) return;
    cancel.mutate(app.id);
  }

  const assign = useMutation({
    mutationFn: ({ gapId, substituteTeacherId }: { gapId: string; substituteTeacherId: string }) =>
      api.post(`/manage/substitution/${gapId}/assign`, { substituteTeacherId }),
    onSuccess: () => {
      toast.success('Substitute assigned.');
      refreshCover();
    },
    onError: coverError,
  });

  const clear = useMutation({
    mutationFn: (gapId: string) => api.post(`/manage/substitution/${gapId}/clear`),
    onSuccess: refreshCover,
    onError: coverError,
  });

  const pendingApps = pending.data ?? [];
  const approvedApps = approved.data ?? [];
  const gaps = [...(coverage.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const uncoveredCount = gaps.filter((g) => !g.substituteTeacherId).length;

  return (
    <>
      <header className="sk-pagehead">
        <div>
          <h1>Leave</h1>
          <p>Review teacher leave requests and cover the classes they leave behind.</p>
        </div>
        <Link href="/app/leave/policy" className="sk-btn">
          Leave policy
        </Link>
      </header>

      <nav className="sk-tabs" role="tablist" aria-label="Leave desk" style={{ marginBottom: 16 }}>
        {LEAVE_TABS.map((t) => {
          const count =
            t.id === 'pending' ? pendingApps.length : t.id === 'approved' ? approvedApps.length : uncoveredCount;
          // Amber is for what is waiting on someone: a decision, or a class with nobody in it.
          const waiting = t.id !== 'approved' && count > 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`leave-tab-${t.id}`}
              aria-controls={`leave-panel-${t.id}`}
              aria-selected={tab === t.id}
              className="sk-tab"
              style={tab === t.id ? { borderBottomColor: 'var(--sk-brand)', color: 'var(--sk-brand-2)' } : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {count > 0 ? (
                <span
                  className="sk-pill"
                  style={waiting ? { background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)' } : undefined}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {tab === 'pending' && (
        <div role="tabpanel" id="leave-panel-pending" aria-labelledby="leave-tab-pending">
        {/* Pending applications */}
        <div className="sk-card" style={{ marginBottom: 16 }}>
          <div className="sk-card-h">
            <h3>Pending applications</h3>
            <p className="sk-muted" style={{ marginTop: 4 }}>
              {pendingApps.length} awaiting review
            </p>
          </div>
          <div className="sk-card-b">
            {pending.isLoading && <p className="sk-state">Loading…</p>}
            {pending.error && <p className="sk-state err">{(pending.error as Error).message}</p>}
            {!pending.isLoading && !pending.error && pendingApps.length === 0 && (
              <p className="sk-state">No pending leave applications.</p>
            )}
            {pendingApps.map((a, i) => {
              const outcome = decided[a.id];
              const own = isOwnLeave(viewerUserId, a.personUserId);
              return (
                <div
                  className="sk-row sk-reqcard"
                  key={a.id}
                  data-decided={outcome ? 'true' : undefined}
                  style={{ alignItems: 'flex-start' }}
                >
                  <span className="badge" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                    {initials(a.teacherName)}
                  </span>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div className="nm">{a.teacherName}</div>
                    <div className="meta">
                      {LEAVE_TYPE_LABEL[a.type]} · {leaveSpan(a, formatDate)}
                      {a.reason ? ` · ${a.reason}` : ''}
                    </div>
                    {(() => {
                      const ctx = pendingContext.data?.[a.id];
                      if (!ctx) return null;
                      const over = ctx.remaining !== null && ctx.requestedDays > ctx.remaining;
                      return (
                        <div className="meta" style={over ? { color: 'var(--sk-bad)' } : undefined}>
                          Asks {ctx.requestedDays} working {ctx.requestedDays === 1 ? 'day' : 'days'}
                          {ctx.remaining !== null &&
                            ` · ${ctx.remaining} left${over ? ` — ${ctx.requestedDays - ctx.remaining} over` : ''}`}
                        </div>
                      );
                    })()}
                  </div>
                  <span className="sp" />
                  {/* Same stamp, same meaning as the Requests desk — an admin
                      who approves leave from either page performs one gesture,
                      not two. Flat amber while it waits; the green/red stamp
                      LANDS only on the decision this admin just took. */}
                  <span
                    className={outcome ? 'sk-reqstamp sk-stampin sk-in' : 'sk-reqstamp'}
                    data-state={outcome ?? 'pending'}
                    aria-hidden="true"
                  >
                    {outcome === 'approved' ? 'APPROVED' : outcome === 'rejected' ? 'REJECTED' : 'PENDING'}
                  </span>
                  <div className="sk-wrap-sm" style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    {own && <span className="meta">{OWN_LEAVE_HINT}</span>}
                    <button
                      type="button"
                      className="sk-btn sk-press"
                      data-variant="primary"
                      disabled={approve.isPending || own}
                      title={own ? OWN_LEAVE_HINT : undefined}
                      onClick={() => {
                        // Warn, never block — the admin may knowingly approve
                        // into the negative (e.g. treat the excess as unpaid).
                        const ctx = pendingContext.data?.[a.id];
                        if (
                          ctx &&
                          ctx.remaining !== null &&
                          ctx.requestedDays > ctx.remaining &&
                          !window.confirm(
                            `${a.teacherName} has ${ctx.remaining} ${ctx.typeName ?? LEAVE_TYPE_LABEL[a.type]} ${
                              ctx.remaining === 1 ? 'day' : 'days'
                            } left and this asks ${ctx.requestedDays} — approve anyway, ${
                              ctx.requestedDays - ctx.remaining
                            } ${ctx.requestedDays - ctx.remaining === 1 ? 'day' : 'days'} over?`,
                          )
                        ) {
                          return;
                        }
                        approve.mutate(a);
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="sk-btn sk-press"
                      disabled={reject.isPending || own}
                      title={own ? OWN_LEAVE_HINT : undefined}
                      onClick={() => reject.mutate(a.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      )}

      {tab === 'approved' && (
        <div role="tabpanel" id="leave-panel-approved" aria-labelledby="leave-tab-approved">
        {/* Approved leaves — cancellable, no approval step needed */}
        <div className="sk-card" style={{ marginBottom: 16 }}>
          <div className="sk-card-h">
            <h3>Approved leaves</h3>
            <p className="sk-muted" style={{ marginTop: 4 }}>
              {approvedApps.length} approved
            </p>
          </div>
          <div className="sk-card-b">
            {approved.isLoading && <p className="sk-state">Loading…</p>}
            {approved.error && <p className="sk-state err">{(approved.error as Error).message}</p>}
            {!approved.isLoading && !approved.error && approvedApps.length === 0 && (
              <p className="sk-state">No approved leaves.</p>
            )}
            {approvedApps.map((a, i) => (
              <div className="sk-row sk-reqcard" key={a.id} style={{ alignItems: 'flex-start' }}>
                <span className="badge" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                  {initials(a.teacherName)}
                </span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="nm">{a.teacherName}</div>
                  <div className="meta">
                    {LEAVE_TYPE_LABEL[a.type]} · {leaveSpan(a, formatDate)}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </div>
                </div>
                <span className="sp" />
                {/* Printed, never landing: these were approved on some earlier
                    day. A stamp coming down here on every page load would claim
                    a decision was just made, which is exactly the lie the
                    gesture must not tell. */}
                <span className="sk-reqstamp" data-state="approved" aria-hidden="true">
                  APPROVED
                </span>
                <div className="sk-wrap-sm" style={{ flexBasis: '100%', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    disabled={cancel.isPending}
                    onClick={() => onCancel(a)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        </div>
      )}

      {tab === 'coverage' && (
        <div role="tabpanel" id="leave-panel-coverage" aria-labelledby="leave-tab-coverage">
        {/* Coverage panel */}
        <div className="sk-card">
          <div
            className="sk-card-h"
            style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
          >
            <div>
              <h3>Coverage</h3>
              <p className="sk-muted" style={{ marginTop: 4 }}>
                {gaps.length === 0
                  ? 'No coverage gaps in this range.'
                  : `${gaps.length} gap${gaps.length === 1 ? '' : 's'} · ${uncoveredCount} still ${
                      uncoveredCount === 1 ? 'needs' : 'need'
                    } a substitute`}
              </p>
            </div>
            <div className="sk-wrap-sm" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="cov-from" className="sk-lab">
                  From
                </label>
                <input
                  id="cov-from"
                  type="date"
                  value={range.from}
                  onFocus={ringFocus}
                  onBlur={ringBlur}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  style={fieldStyle}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="cov-to" className="sk-lab">
                  To
                </label>
                <input
                  id="cov-to"
                  type="date"
                  value={range.to}
                  onFocus={ringFocus}
                  onBlur={ringBlur}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  style={fieldStyle}
                />
              </div>
            </div>
          </div>
          <div className="sk-card-b">
            {coverage.isLoading && <p className="sk-state">Loading coverage gaps…</p>}
            {coverage.error && <p className="sk-state err">{(coverage.error as Error).message}</p>}
            {!coverage.isLoading && !coverage.error && gaps.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CalendarClock className="h-8 w-8" style={{ color: 'var(--sk-ink-3)' }} />
                <p className="sk-state">Nothing to cover in this date range.</p>
              </div>
            )}

            {/* THE LIST OWNS THE COLUMNS: every row's picker, link and status
                start at the same x, whatever the class name or teacher. */}
            {gaps.length > 0 && (
              <RowList columns="minmax(0, 1.3fr) minmax(0, 1fr) auto auto" label="Classes to cover">
                {gaps.map((gap) => {
                  const covered = !!gap.substituteTeacherId;
                  return (
                    <Row key={gap.id} testId={`cover-${gap.id}`}>
                      <Cell>
                        <RowTitle
                          title={`${gap.classSectionName} · ${gap.periodLabel}`}
                          sub={`${formatDate(gap.date)} · ${gap.originalTeacherName} (on leave)`}
                        />
                        {covered ? (
                          <span className="sk-rowsub">
                            {gap.substituteTeacherName} · {gap.acknowledgedAt ? `seen ${seenAt(gap.acknowledgedAt)}` : 'not yet seen'}
                          </span>
                        ) : null}
                      </Cell>
                      <Cell>
                        <CoverPicker
                          gap={gap}
                          disabled={assign.isPending}
                          onPick={(substituteTeacherId) => assign.mutate({ gapId: gap.id, substituteTeacherId })}
                        />
                      </Cell>
                      <Cell>
                        <Link href={`/app/timetable?classSectionId=${gap.classSectionId}`} className="sk-btn sk-press">
                          Open class timetable
                        </Link>
                      </Cell>
                      <Cell align="end">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="sk-pill" data-tone={covered ? 'good' : 'warn'}>
                            {covered ? 'Covered' : 'Needs cover'}
                          </span>
                          {covered && (
                            <button
                              type="button"
                              className="sk-btn sk-press"
                              disabled={clear.isPending}
                              onClick={() => clear.mutate(gap.id)}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </Cell>
                    </Row>
                  );
                })}
              </RowList>
            )}
          </div>
        </div>
        </div>
      )}

    </>
  );
}
