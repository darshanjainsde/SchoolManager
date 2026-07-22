'use client';
import { useState, useMemo, type CSSProperties, type FocusEvent } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SchoolClass {
  id: string;
  name: string;
  academicYearId: string;
  grade: { name: string };
}

interface Period {
  id: string;
  label: string;
  order: number;
  startTime: string;
  endTime: string;
  kind: 'CLASS' | 'BREAK';
}

interface Subject {
  id: string;
  name: string;
  code?: string | null;
}

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
}

interface TimetableSlot {
  id: string;
  classSectionId: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  teacherId: string;
  academicYearId: string;
  period: { order: number; label: string; startTime: string; endTime: string };
  subject: { name: string; code?: string | null };
  teacher: { firstName: string; lastName: string };
}

// ── Date helpers ──────────────────────────────────────────────────────────────
// Plain, dependency-free date math (no date-fns in this app) matching the
// `School.workingDays` convention: 1 = Monday … 7 = Sunday.

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO weekday of `d`: Mon=1 … Sun=7 (matches `School.workingDays`). */
function isoWeekday(d: Date): number {
  const js = d.getDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

/** Local midnight for the Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - (isoWeekday(d) - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** `YYYY-MM-DD` — the shape the API's `?date=` query param expects. */
function toDateParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShort(d: Date): string {
  return `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
}

/** e.g. "Jul 20–26, 2026" (or "Jul 28 – Aug 3, 2026" across a month boundary). */
function weekRangeLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  if (monday.getMonth() === sunday.getMonth()) {
    return `${MONTH_LABELS[monday.getMonth()]} ${monday.getDate()}–${sunday.getDate()}, ${sunday.getFullYear()}`;
  }
  return `${formatShort(monday)} – ${formatShort(sunday)}, ${sunday.getFullYear()}`;
}

interface DayColumn {
  value: number;
  label: string;
  date: Date;
}

// Themed inputs/selects: no dedicated CSS class, styled inline, with a
// brand-colored focus ring applied directly to the DOM node on focus/blur.
const fieldStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  border: '1px solid var(--sk-line-2)',
  borderRadius: 10,
  padding: '9px 11px',
  background: 'var(--sk-card)',
  color: 'var(--sk-ink)',
  fontSize: 13.5,
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

const headCellStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--sk-ink-3)',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--sk-line)',
};

// ── Assign Modal ──────────────────────────────────────────────────────────────

interface AssignModalProps {
  periodLabel: string;
  dayLabel: string;
  subjects: Subject[];
  teachers: Teacher[];
  onAssign: (subjectId: string, teacherId: string) => void;
  isAssigning: boolean;
  onClose: () => void;
}

function AssignModal({
  periodLabel,
  dayLabel,
  subjects,
  teachers,
  onAssign,
  isAssigning,
  onClose,
}: AssignModalProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? '');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 30, 24, 0.5)',
        padding: 16,
      }}
    >
      <div className="sk-card" style={{ width: '100%', maxWidth: 380 }}>
        <div className="sk-card-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3>
            Assign period — {dayLabel}, {periodLabel}
          </h3>
          <button onClick={onClose} className="sk-btn" aria-label="Close" style={{ padding: 7 }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="sk-card-b">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label htmlFor="tt-subject" className="sk-lab">
              Subject
            </label>
            <select
              id="tt-subject"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              {subjects.length === 0 && <option value="">No subjects — add one in Classes</option>}
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.code ? ` (${s.code})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label htmlFor="tt-teacher" className="sk-lab">
              Teacher
            </label>
            <select
              id="tt-teacher"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              {teachers.length === 0 && <option value="">No teachers found</option>}
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              className="sk-btn"
              data-variant="primary"
              onClick={() => onAssign(subjectId, teacherId)}
              disabled={isAssigning || !subjectId || !teacherId}
            >
              {isAssigning ? 'Assigning…' : 'Assign'}
            </button>
            <button className="sk-btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PendingCell {
  dayOfWeek: number;
  periodId: string;
  dayLabel: string;
  periodLabel: string;
}

export default function TimetablePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [classSectionId, setClassSectionId] = useState('');
  const [pendingCell, setPendingCell] = useState<PendingCell | null>(null);
  // 0 = the week containing today; -1 = last week; +1 = next week, etc.
  const [weekOffset, setWeekOffset] = useState(0);

  // ── Week math ──────────────────────────────────────────────────────────────
  const now = new Date();
  const isCurrentWeek = weekOffset === 0;
  const isPastWeek = weekOffset < 0;
  const viewedMonday = addDays(mondayOf(now), weekOffset * 7);
  // Read the timetable as-of a date INSIDE the viewed week: today for the
  // current week (so a slot assigned today — effectiveFrom=today — shows),
  // the week's last day for a past week (what was live then), and the week's
  // Monday for a future week. Reading as-of Monday alone would hide an edit
  // made later in the current week.
  const viewedSunday = addDays(viewedMonday, 6);
  const asOfDate = now < viewedMonday ? viewedMonday : now > viewedSunday ? viewedSunday : now;
  const dateParam = toDateParam(asOfDate);

  // ── Queries ──────────────────────────────────────────────────────────────
  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const periodsQuery = useQuery({
    queryKey: ['mng-periods'],
    queryFn: () => api.get<Period[]>('/manage/periods'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const workingDaysQuery = useQuery({
    queryKey: ['mng-working-days'],
    queryFn: () => api.get<{ workingDays: number[] }>('/manage/school/working-days'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const subjectsQuery = useQuery({
    queryKey: ['mng-subjects'],
    queryFn: () => api.get<Subject[]>('/manage/subjects'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const teachersQuery = useQuery({
    queryKey: ['mng-teachers'],
    queryFn: () => api.get<Teacher[]>('/manage/teachers'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const timetableQuery = useQuery({
    queryKey: ['timetable', classSectionId, dateParam],
    queryFn: () =>
      api.get<TimetableSlot[]>(
        `/manage/timetable?classSectionId=${encodeURIComponent(classSectionId)}&date=${dateParam}`,
      ),
    enabled: !!host && !!classSectionId,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  // ── Derived data ─────────────────────────────────────────────────────────
  const sortedPeriods = useMemo(
    () =>
      [...(periodsQuery.data ?? [])].sort(
        // Chronological, so a break/lunch sits between the periods it separates
        // rather than at the bottom (its `order` may not reflect its time).
        (a, b) => a.startTime.localeCompare(b.startTime) || a.order - b.order,
      ),
    [periodsQuery.data],
  );

  // Working days default to Mon–Sat (the schema default) until the real
  // value loads, so the grid doesn't flash empty on first paint.
  const workingDays = workingDaysQuery.data?.workingDays ?? [1, 2, 3, 4, 5, 6];
  const dayColumns: DayColumn[] = [...workingDays]
    .sort((a, b) => a - b)
    .map((value) => ({
      value,
      label: WEEKDAY_LABELS[value] ?? `Day ${value}`,
      date: addDays(viewedMonday, value - 1),
    }));

  // O(1) lookup: `${dayOfWeek}-${periodId}` → slot
  const slotMap = useMemo(() => {
    const map = new Map<string, TimetableSlot>();
    for (const slot of timetableQuery.data ?? []) {
      map.set(`${slot.dayOfWeek}-${slot.periodId}`, slot);
    }
    return map;
  }, [timetableQuery.data]);

  // academicYearId comes from the selected class object
  const selectedClass = useMemo(
    () => (classesQuery.data ?? []).find((c) => c.id === classSectionId),
    [classesQuery.data, classSectionId],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const assignMutation = useMutation({
    mutationFn: (body: {
      classSectionId: string;
      dayOfWeek: number;
      periodId: string;
      subjectId: string;
      teacherId: string;
      academicYearId: string;
    }) => api.post<TimetableSlot>('/manage/timetable', body),
    onSuccess: () => {
      // Prefix-matches every `['timetable', classSectionId, <date>]` query,
      // regardless of which week was being viewed when this fired.
      void queryClient.invalidateQueries({ queryKey: ['timetable', classSectionId] });
      setPendingCell(null);
      toast.success('Slot assigned');
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(`Clash: ${err.message}`);
      } else if (err instanceof ApiError && err.status === 400) {
        toast.error(`Invalid reference: ${err.message}`);
      } else {
        toast.error(`Failed to assign slot: ${err.message}`);
      }
      // Do NOT fill the cell; query cache is unchanged
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (slotId: string) => api.del<{ ok: boolean }>(`/manage/timetable/${slotId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['timetable', classSectionId] });
      toast.success('Slot removed');
    },
    onError: (err: Error) => toast.error(`Failed to remove slot: ${err.message}`),
  });

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeleteSlot(slot: TimetableSlot, dayLabel: string) {
    const ok = window.confirm(
      `Remove ${slot.subject.name} from ${dayLabel} ${slot.period.label}? This can’t be undone.`,
    );
    if (ok) deleteMutation.mutate(slot.id);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Page header */}
      <header className="sk-pagehead">
        <h1>Timetable builder</h1>
        <p>Assign teacher + subject to each period. Clashes are flagged automatically.</p>
      </header>

      {/* Class selector */}
      <div className="sk-card" style={{ marginBottom: 18, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label htmlFor="tt-class" className="sk-lab" style={{ flex: 'none' }}>
          Class
        </label>
        <select
          id="tt-class"
          style={{ ...fieldStyle, maxWidth: 260 }}
          onFocus={ringFocus}
          onBlur={ringBlur}
          value={classSectionId}
          onChange={(e) => setClassSectionId(e.target.value)}
        >
          <option value="">— Select a class —</option>
          {(classesQuery.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.grade.name} — {c.name}
            </option>
          ))}
        </select>
        {classesQuery.isLoading && <span className="sk-state">Loading classes…</span>}
      </div>

      {/* Prompt when no class selected */}
      {!classSectionId && <p className="sk-state">Select a class above to view and edit its timetable.</p>}

      {classSectionId && (
        <>
          {/* Week navigation */}
          <div
            className="sk-card"
            style={{
              marginBottom: 12,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <button
              className="sk-btn"
              onClick={() => setWeekOffset((w) => w - 1)}
              aria-label="Previous week"
              style={{ padding: '7px 10px' }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              {weekRangeLabel(viewedMonday)}
              {isCurrentWeek && (
                <span className="sk-pill" data-tone="info">
                  This week
                </span>
              )}
              {isPastWeek && (
                <span className="sk-pill" data-tone="warn">
                  Past
                </span>
              )}
            </div>
            <button
              className="sk-btn"
              onClick={() => setWeekOffset((w) => w + 1)}
              aria-label="Next week"
              style={{ padding: '7px 10px' }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              className="sk-btn"
              onClick={() => setWeekOffset(0)}
              disabled={isCurrentWeek}
              style={{ marginLeft: 'auto' }}
            >
              Today
            </button>
          </div>

          {isPastWeek && <p className="sk-state">🔒 Past week — read-only</p>}
        </>
      )}

      {/* Loading timetable */}
      {classSectionId && timetableQuery.isLoading && <p className="sk-state">Loading timetable…</p>}

      {/* Error */}
      {classSectionId && timetableQuery.error && (
        <p className="sk-state err">{(timetableQuery.error as Error).message}</p>
      )}

      {/* Grid */}
      {classSectionId && !timetableQuery.isLoading && !timetableQuery.error && (
        <div className="sk-card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ ...headCellStyle, textAlign: 'left', width: 116 }}>Period</th>
                  {dayColumns.map((day) => {
                    const highlight = isCurrentWeek && isSameCalendarDay(day.date, now);
                    return (
                      <th
                        key={day.value}
                        style={{
                          ...headCellStyle,
                          background: highlight ? 'var(--sk-brand-tint)' : undefined,
                          color: highlight ? 'var(--sk-brand-2)' : headCellStyle.color,
                        }}
                      >
                        <div>{day.label}</div>
                        <div style={{ fontWeight: 500, letterSpacing: 'normal', textTransform: 'none', fontSize: 9.5, marginTop: 2 }}>
                          {formatShort(day.date)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedPeriods.length === 0 && (
                  <tr>
                    <td colSpan={dayColumns.length + 1} style={{ padding: 20, textAlign: 'center' }}>
                      <span className="sk-state">
                        No periods configured.{' '}
                        <Link href="/app/settings" style={{ color: 'var(--sk-brand-2)', fontWeight: 600 }}>
                          Add periods in Settings →
                        </Link>
                      </span>
                    </td>
                  </tr>
                )}

                {sortedPeriods.map((period) => {
                  // Breaks render as a single full-width band, not per-day
                  // assignable cells — there's nothing to assign in a break.
                  if (period.kind === 'BREAK') {
                    return (
                      <tr key={period.id}>
                        <td
                          colSpan={dayColumns.length + 1}
                          style={{
                            padding: '9px 12px',
                            borderTop: '1px solid var(--sk-line)',
                            background: 'var(--sk-amber-tint)',
                            fontSize: 12,
                          }}
                        >
                          <span style={{ fontWeight: 700, color: 'var(--sk-amber)' }}>{period.label}</span>{' '}
                          <span style={{ color: 'var(--sk-ink-3)' }}>
                            · {period.startTime} – {period.endTime}
                          </span>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={period.id}>
                      {/* Period label */}
                      <td
                        style={{
                          padding: '10px 12px',
                          borderTop: '1px solid var(--sk-line)',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'top',
                        }}
                      >
                        <div style={{ fontWeight: 650, fontSize: 13 }}>{period.label}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--sk-ink-3)' }}>
                          {period.startTime} – {period.endTime}
                        </div>
                      </td>

                      {/* Day columns */}
                      {dayColumns.map((day) => {
                        const key = `${day.value}-${period.id}`;
                        const slot = slotMap.get(key);

                        if (slot) {
                          return (
                            <td key={day.value} style={{ padding: 6, borderTop: '1px solid var(--sk-line)' }}>
                              <div
                                className="group"
                                style={{
                                  position: 'relative',
                                  border: '1px solid var(--sk-line)',
                                  borderRadius: 9,
                                  background: 'var(--sk-card)',
                                  padding: '8px 10px',
                                  minHeight: 50,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'center',
                                }}
                              >
                                <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.subject.name}</div>
                                <div style={{ fontSize: 10.5, color: 'var(--sk-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {slot.teacher.firstName} {slot.teacher.lastName}
                                </div>
                                {/* Delete action — hidden for read-only past weeks */}
                                {!isPastWeek && (
                                  <button
                                    onClick={() => confirmDeleteSlot(slot, day.label)}
                                    disabled={deleteMutation.isPending}
                                    aria-label={`Remove ${slot.subject.name} from ${day.label} ${period.label}`}
                                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                                    style={{
                                      position: 'absolute',
                                      top: 4,
                                      right: 4,
                                      display: 'grid',
                                      placeItems: 'center',
                                      width: 20,
                                      height: 20,
                                      borderRadius: 6,
                                      border: 'none',
                                      background: 'transparent',
                                      color: 'var(--sk-ink-3)',
                                      cursor: 'pointer',
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = 'var(--sk-bad-tint)';
                                      e.currentTarget.style.color = 'var(--sk-bad)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'transparent';
                                      e.currentTarget.style.color = 'var(--sk-ink-3)';
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // Past weeks are read-only: no assign affordance on empty cells.
                        if (isPastWeek) {
                          return (
                            <td key={day.value} style={{ padding: 6, borderTop: '1px solid var(--sk-line)' }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  minHeight: 50,
                                  fontSize: 12,
                                  color: 'var(--sk-ink-3)',
                                }}
                              >
                                —
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td key={day.value} style={{ padding: 6, borderTop: '1px solid var(--sk-line)' }}>
                            <button
                              onClick={() =>
                                setPendingCell({
                                  dayOfWeek: day.value,
                                  periodId: period.id,
                                  dayLabel: `${day.label} ${formatShort(day.date)}`,
                                  periodLabel: period.label,
                                })
                              }
                              aria-label={`Assign ${day.label} ${period.label}`}
                              style={{
                                display: 'flex',
                                width: '100%',
                                minHeight: 50,
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4,
                                borderRadius: 9,
                                border: '1px dashed var(--sk-line-2)',
                                background: 'transparent',
                                color: 'var(--sk-brand-2)',
                                cursor: 'pointer',
                                transition: 'background 0.12s, border-color 0.12s',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'var(--sk-brand-tint)';
                                e.currentTarget.style.borderColor = 'var(--sk-brand)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.borderColor = 'var(--sk-line-2)';
                              }}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Assign modal */}
      {pendingCell && (
        <AssignModal
          periodLabel={pendingCell.periodLabel}
          dayLabel={pendingCell.dayLabel}
          subjects={subjectsQuery.data ?? []}
          teachers={teachersQuery.data ?? []}
          onAssign={(subjectId, teacherId) => {
            if (!selectedClass) return;
            assignMutation.mutate({
              classSectionId,
              dayOfWeek: pendingCell.dayOfWeek,
              periodId: pendingCell.periodId,
              subjectId,
              teacherId,
              academicYearId: selectedClass.academicYearId,
            });
          }}
          isAssigning={assignMutation.isPending}
          onClose={() => {
            setPendingCell(null);
            assignMutation.reset();
          }}
        />
      )}
    </>
  );
}
