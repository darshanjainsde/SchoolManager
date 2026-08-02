'use client';
import { useMemo, useState, type CSSProperties, type FocusEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaveType = 'SICK' | 'CASUAL' | 'EARNED' | 'UNPAID' | 'OTHER';
type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** Dates arrive as ISO strings over the wire even though the API types them as Date. */
interface LeaveApplication {
  id: string;
  teacherId: string;
  teacherName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
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
}

interface AvailabilityTeacher {
  id: string;
  firstName: string;
  lastName: string;
}
interface BusyEntry {
  teacherId: string;
  dayOfWeek: number;
  periodId: string;
}
interface AvailabilityResponse {
  teachers: AvailabilityTeacher[];
  periods: { id: string; order: number; label: string }[];
  busy: BusyEntry[];
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

/** ISO weekday (1=Mon…7=Sun) of an ISO date/datetime string, in UTC. */
function isoWeekdayOf(iso: string): number {
  const js = new Date(iso).getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
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

  const pending = useQuery({
    queryKey: ['a-leave-pending'],
    enabled: !!host,
    queryFn: () => api.get<LeaveApplication[]>('/manage/leave?status=PENDING'),
  });

  const approved = useQuery({
    queryKey: ['a-leave-approved'],
    enabled: !!host,
    queryFn: () => api.get<LeaveApplication[]>('/manage/leave?status=APPROVED'),
  });

  const coverage = useQuery({
    queryKey: ['a-leave-coverage', range.from, range.to],
    enabled: !!host && !!range.from && !!range.to,
    queryFn: () =>
      api.get<CoverageGap[]>(
        `/manage/leave/coverage?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
  });

  // Shared across every gap row — the same "who is free per weekday+period"
  // data the /app/availability page uses, reused here for the coverage
  // dropdowns rather than duplicating the busy/free logic.
  const availability = useQuery({
    queryKey: ['a-leave-availability'],
    enabled: !!host,
    queryFn: () => api.get<AvailabilityResponse>('/manage/availability'),
  });

  const busySet = useMemo(() => {
    const s = new Set<string>();
    for (const b of availability.data?.busy ?? []) s.add(`${b.teacherId}-${b.dayOfWeek}-${b.periodId}`);
    return s;
  }, [availability.data]);

  function freeTeachersFor(gap: CoverageGap): AvailabilityTeacher[] {
    const weekday = isoWeekdayOf(gap.date);
    const teachers = availability.data?.teachers ?? [];
    return teachers.filter((t) => !busySet.has(`${t.id}-${weekday}-${gap.periodId}`));
  }

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
      setRange({ from: toDateStr(app.startDate), to: toDateStr(app.endDate) });
      void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/manage/leave/${id}/reject`),
    onSuccess: (_result, id) => {
      setDecided((d) => ({ ...d, [id]: 'rejected' }));
      toast.success('Application rejected.');
      void qc.invalidateQueries({ queryKey: ['a-leave-pending'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post<{ status: string; restoredDates: number }>(`/manage/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success('Leave cancelled — classes and attendance restored.');
      void qc.invalidateQueries({ queryKey: ['a-leave-pending'] });
      void qc.invalidateQueries({ queryKey: ['a-leave-approved'] });
      void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onCancel(app: LeaveApplication) {
    if (!window.confirm(`Cancel ${app.teacherName}'s leave? Their classes will be restored.`)) return;
    cancel.mutate(app.id);
  }

  const assign = useMutation({
    mutationFn: ({ gapId, substituteTeacherId }: { gapId: string; substituteTeacherId: string }) =>
      api.post(`/manage/substitution/${gapId}/assign`, { substituteTeacherId }),
    onSuccess: () => {
      toast.success('Substitute assigned.');
      void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clear = useMutation({
    mutationFn: (gapId: string) => api.post(`/manage/substitution/${gapId}/clear`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['a-leave-coverage'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingApps = pending.data ?? [];
  const approvedApps = approved.data ?? [];
  const gaps = [...(coverage.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const uncoveredCount = gaps.filter((g) => !g.substituteTeacherId).length;

  return (
    <>
      <header className="sk-pagehead">
        <h1>Leave</h1>
        <p>Review teacher leave requests and cover the classes they leave behind.</p>
      </header>

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
                    {LEAVE_TYPE_LABEL[a.type]} · {formatDate(a.startDate)} – {formatDate(a.endDate)}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </div>
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
                <div style={{ flexBasis: '100%', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    data-variant="primary"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(a)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    disabled={reject.isPending}
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
                  {LEAVE_TYPE_LABEL[a.type]} · {formatDate(a.startDate)} – {formatDate(a.endDate)}
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
              <div style={{ flexBasis: '100%', display: 'flex', justifyContent: 'flex-end' }}>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
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

          {gaps.map((gap) => {
            const covered = !!gap.substituteTeacherId;
            const free = freeTeachersFor(gap);
            const options = [...free];
            if (gap.substituteTeacherId && !free.some((t) => t.id === gap.substituteTeacherId)) {
              // Keep the currently-assigned teacher selectable even if a
              // later schedule change made them busy — don't silently
              // disappear the current assignment from its own dropdown.
              options.unshift({
                id: gap.substituteTeacherId,
                firstName: gap.substituteTeacherName ?? 'Assigned',
                lastName: 'teacher',
              });
            }

            return (
              <div className="sk-row" key={gap.id} style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 10 }}>
                <div style={{ minWidth: 170 }}>
                  <div className="nm">{formatDate(gap.date)}</div>
                  <div className="meta">
                    {gap.classSectionName} · {gap.periodLabel}
                  </div>
                  <div className="meta">{gap.originalTeacherName} (on leave)</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
                  <label className="sk-lab" htmlFor={`cov-assign-${gap.id}`}>
                    Substitute
                  </label>
                  <select
                    id={`cov-assign-${gap.id}`}
                    style={fieldStyle}
                    onFocus={ringFocus}
                    onBlur={ringBlur}
                    value={gap.substituteTeacherId ?? ''}
                    disabled={assign.isPending}
                    onChange={(e) => {
                      const substituteTeacherId = e.target.value;
                      if (!substituteTeacherId) return;
                      assign.mutate({ gapId: gap.id, substituteTeacherId });
                    }}
                  >
                    <option value="">
                      {availability.isLoading ? 'Loading…' : 'Pick a free teacher…'}
                    </option>
                    {options.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.firstName} {t.lastName}
                      </option>
                    ))}
                  </select>
                </div>

                <Link href={`/app/timetable?classSectionId=${gap.classSectionId}`} className="sk-btn sk-press">
                  Open class timetable
                </Link>

                <span className="sp" />

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
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
