'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, X, CalendarCheck } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { cn } from '@/lib/cn';

// ── Types ────────────────────────────────────────────────────────────────────

// The API only accepts these four (StaffAttendanceMarkDto @IsIn). Anything
// else would be rejected server-side, so the UI never offers it.
type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE';
type Kind = 'TEACHER' | 'STAFF';
type KindFilter = 'ALL' | Kind;

const STATUSES: Status[] = ['PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE'];
const STATUS_LABEL: Record<Status, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  ON_LEAVE: 'On leave',
};
// Traffic-light tones from the theme, plus a fourth (violet) for On leave —
// the theme has no dedicated "leave" variable, so this reuses the same
// violet already used as an avatar accent elsewhere in the admin app.
const STATUS_COLOR: Record<Status, string> = {
  PRESENT: 'var(--sk-good)',
  ABSENT: 'var(--sk-bad)',
  LATE: 'var(--sk-amber)',
  ON_LEAVE: '#6b5ca8',
};

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

interface RosterPerson {
  id: string;
  name: string;
  kind: Kind;
  role?: string;
  status: Status;
}

interface RosterResponse {
  people: RosterPerson[];
}

interface SaveResult {
  saved: number;
  absentees: number;
}

interface PersonDay {
  /** `YYYY-MM-DD` */
  date: string;
  status: Status;
}

interface PersonSummary {
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  percent: number;
  days: PersonDay[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

/** Composite key so a TEACHER and a STAFF row can never collide by raw id. */
function markKey(kind: Kind, id: string): string {
  return `${kind}:${id}`;
}

/** Today in the browser's own timezone — `toISOString()` would give the UTC day. */
const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ── Month helpers (mirrors the student portal's attendance calendar) ────────

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(k: string, delta: number): string {
  const year = Number(k.slice(0, 4));
  const monthIndex = Number(k.slice(5, 7)) - 1 + delta;
  return monthKeyOf(new Date(year, monthIndex, 1));
}
function monthLabel(k: string): string {
  const year = Number(k.slice(0, 4));
  const monthIndex = Number(k.slice(5, 7)) - 1;
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function daysInMonth(k: string): number {
  const year = Number(k.slice(0, 4));
  const monthIndex = Number(k.slice(5, 7)) - 1;
  return new Date(year, monthIndex + 1, 0).getDate();
}
function leadingBlanks(k: string): number {
  const year = Number(k.slice(0, 4));
  const monthIndex = Number(k.slice(5, 7)) - 1;
  return (new Date(year, monthIndex, 1).getDay() + 6) % 7;
}
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Dialog shell (Escape-to-close + basic focus trap) ────────────────────────

function DialogShell({
  onClose,
  labelledBy,
  maxWidth = 480,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  maxWidth?: number;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    const focusable = el?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && el) {
        const items = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

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
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className="sk-card"
        style={{ width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

// ── Attendance card modal — the per-person monthly view ──────────────────────

function AttendanceCardModal({
  person,
  onClose,
}: {
  person: { id: string; kind: Kind; name: string; role?: string };
  onClose: () => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const thisMonth = monthKeyOf(new Date());
  const [month, setMonth] = useState(thisMonth);
  const atLatestMonth = month >= thisMonth;

  const { data, isLoading, error, isPlaceholderData } = useQuery({
    queryKey: ['staff-attn-person', person.kind, person.id, month],
    queryFn: () =>
      api.get<PersonSummary>(
        `/manage/staff-attendance/person?kind=${person.kind}&id=${encodeURIComponent(person.id)}&month=${month}`,
      ),
    enabled: !!host,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const statusByDate = new Map<string, Status>((data?.days ?? []).map((d) => [d.date, d.status]));
  const marked = data ? data.present + data.absent + data.late + data.onLeave : 0;

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks(month) }, () => null),
    ...Array.from({ length: daysInMonth(month) }, (_, i) => i + 1),
  ];

  return (
    <DialogShell onClose={onClose} labelledBy="staff-attn-card-h">
      <div
        className="sk-card-h"
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h3 id="staff-attn-card-h">{person.name}</h3>
          {person.role && <p className="sk-muted" style={{ marginTop: 2 }}>{person.role}</p>}
        </div>
        <button onClick={onClose} className="sk-btn sk-press" aria-label="Close" style={{ padding: 7 }}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="sk-card-b">
        {/* Month picker */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label="Previous month"
            className="sk-btn sk-press"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold" style={{ color: 'var(--sk-ink)' }} aria-live="polite">
            {monthLabel(month)}
          </p>
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={atLatestMonth}
            aria-label="Next month"
            className="sk-btn sk-press"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {isLoading && <p className="sk-state">Loading attendance…</p>}
        {error && <p className="sk-state err">{(error as Error).message}</p>}

        {!isLoading && !error && data && (
          <div
            aria-busy={isPlaceholderData}
            className={cn('flex flex-col gap-4 transition-opacity', isPlaceholderData && 'opacity-50')}
          >
            {marked === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CalendarCheck className="h-8 w-8" style={{ color: 'var(--sk-ink-3)' }} />
                <p className="sk-state">No attendance recorded yet for {monthLabel(month)}.</p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-5">
                <div>
                  <p className="text-3xl font-bold" style={{ color: 'var(--sk-ink)' }}>{data.percent}%</p>
                  <p className="sk-muted">
                    present across {marked} recorded {marked === 1 ? 'day' : 'days'}
                  </p>
                </div>
                <dl className="flex flex-wrap gap-2">
                  {(['present', 'absent', 'late', 'onLeave'] as const).map((k) => {
                    const s: Status = k === 'onLeave' ? 'ON_LEAVE' : (k.toUpperCase() as Status);
                    return (
                      <div
                        key={k}
                        style={{
                          borderRadius: 10,
                          padding: '8px 12px',
                          textAlign: 'center',
                          background: `color-mix(in srgb, ${STATUS_COLOR[s]} 14%, transparent)`,
                        }}
                      >
                        <dt style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[s] }}>
                          {STATUS_LABEL[s]}
                        </dt>
                        <dd style={{ fontSize: 18, fontWeight: 700, color: STATUS_COLOR[s] }}>{data[k]}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}

            {/* Month calendar */}
            <div>
              <div
                className="grid grid-cols-7 gap-1.5"
                aria-label={`Attendance calendar for ${monthLabel(month)}`}
              >
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} aria-hidden="true" className="pb-1 text-center text-xs font-medium" style={{ color: 'var(--sk-ink-3)' }}>
                    {label}
                  </div>
                ))}
                {cells.map((dayNum, i) => {
                  if (dayNum === null) return <div key={`blank-${i}`} aria-hidden="true" />;
                  const date = `${month}-${String(dayNum).padStart(2, '0')}`;
                  const status = statusByDate.get(date);
                  return (
                    <div
                      key={date}
                      aria-label={`${date}: ${status ? STATUS_LABEL[status] : 'no record'}`}
                      className="flex aspect-square items-center justify-center rounded-md border text-xs font-medium"
                      style={
                        status
                          ? {
                              borderColor: STATUS_COLOR[status],
                              background: `color-mix(in srgb, ${STATUS_COLOR[status]} 14%, transparent)`,
                              color: STATUS_COLOR[status],
                            }
                          : { borderColor: 'var(--sk-line)', background: 'var(--sk-paper)', color: 'var(--sk-ink-3)' }
                      }
                    >
                      {dayNum}
                    </div>
                  );
                })}
              </div>

              <ul className="mt-3 flex flex-wrap gap-3" style={{ fontSize: 11.5, color: 'var(--sk-ink-3)' }}>
                {STATUSES.map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span
                      style={{
                        display: 'inline-block',
                        width: 11,
                        height: 11,
                        borderRadius: 3,
                        border: `1px solid ${STATUS_COLOR[s]}`,
                        background: `color-mix(in srgb, ${STATUS_COLOR[s]} 14%, transparent)`,
                      }}
                    />
                    {STATUS_LABEL[s]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </DialogShell>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StaffAttendancePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [date, setDate] = useState(todayIso());
  const [filter, setFilter] = useState<KindFilter>('ALL');
  const [cardPerson, setCardPerson] = useState<{ id: string; kind: Kind; name: string; role?: string } | null>(
    null,
  );

  const roster = useQuery({
    queryKey: ['staff-attn-roster', date],
    enabled: !!host && !!date,
    queryFn: () => api.get<RosterResponse>(`/manage/staff-attendance?date=${encodeURIComponent(date)}`),
  });

  const people = useMemo(() => roster.data?.people ?? [], [roster.data]);

  // Server marks are the source of truth whenever the date changes; local
  // edits layer on top until the next successful fetch.
  const [marks, setMarks] = useState<Record<string, Status>>({});
  useEffect(() => {
    if (!roster.data) return;
    setMarks(Object.fromEntries(roster.data.people.map((p) => [markKey(p.kind, p.id), p.status])));
  }, [roster.data]);

  const visiblePeople = useMemo(
    () => (filter === 'ALL' ? people : people.filter((p) => p.kind === filter)),
    [people, filter],
  );

  const counts = useMemo(() => {
    const tally: Record<Status, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, ON_LEAVE: 0 };
    for (const p of people) tally[marks[markKey(p.kind, p.id)] ?? 'PRESENT'] += 1;
    return tally;
  }, [people, marks]);

  const save = useMutation({
    mutationFn: () =>
      api.put<SaveResult>('/manage/staff-attendance', {
        date,
        marks: people.map((p) => ({
          personId: p.id,
          kind: p.kind,
          status: marks[markKey(p.kind, p.id)] ?? 'PRESENT',
        })),
      }),
    onSuccess: (result) => {
      toast.success(
        result.absentees === 0
          ? `Attendance saved — ${result.saved} people, nobody absent.`
          : `Attendance saved — ${result.saved} people, ${result.absentees} absent.`,
      );
      void qc.invalidateQueries({ queryKey: ['staff-attn-roster', date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      {cardPerson && <AttendanceCardModal person={cardPerson} onClose={() => setCardPerson(null)} />}

      <header className="sk-pagehead">
        <h1>Staff attendance</h1>
        <p>Mark everyone present, absent, late, or on leave for the day. Click a name to see their monthly record.</p>
      </header>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Date &amp; roster</h3>
        </div>
        <div className="sk-card-b">
          <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="sa-date" className="sk-lab">
                Date
              </label>
              <input
                id="sa-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  border: '1px solid var(--sk-line-2)',
                  borderRadius: 10,
                  padding: '9px 11px',
                  background: 'var(--sk-card)',
                  color: 'var(--sk-ink)',
                  fontSize: 13.5,
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div className="space-y-1.5">
              <span className="sk-lab">Group</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(
                  [
                    ['ALL', 'All'],
                    ['TEACHER', 'Teaching'],
                    ['STAFF', 'Non-teaching'],
                  ] as [KindFilter, string][]
                ).map(([value, label]) => {
                  const active = filter === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(value)}
                      className="sk-btn sk-press"
                      data-variant={active ? 'primary' : undefined}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="sk-btn sk-press"
              data-variant="primary"
              disabled={!date || people.length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save attendance'}
            </button>
          </div>

          {roster.error && <p className="sk-state err">{(roster.error as Error).message}</p>}

          {people.length > 0 && (
            <div>
              <button
                type="button"
                className="sk-btn sk-press"
                onClick={() =>
                  setMarks(Object.fromEntries(people.map((p) => [markKey(p.kind, p.id), 'PRESENT' as Status])))
                }
              >
                Mark all present
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Roster</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            {date
              ? `${visiblePeople.length} people · ${counts.PRESENT} present · ${counts.ABSENT} absent · ${counts.LATE} late · ${counts.ON_LEAVE} on leave`
              : 'Pick a date to begin.'}
          </p>
        </div>
        <div className="sk-card-b">
          {roster.isLoading && <p className="sk-state">Loading roster…</p>}

          {!roster.isLoading && !roster.error && visiblePeople.length === 0 && (
            <p className="sk-state">
              {people.length === 0
                ? 'No teachers or staff on record yet — add them under Teachers/Staff first.'
                : 'Nobody in this group.'}
            </p>
          )}

          {visiblePeople.length > 0 && (
            <div>
              {visiblePeople.map((p, i) => {
                const k = markKey(p.kind, p.id);
                const status = marks[k] ?? 'PRESENT';
                return (
                  <div className="sk-row" key={k}>
                    <span className="badge" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                      {initials(p.name)}
                    </span>
                    <div>
                      <button
                        type="button"
                        className="nm"
                        onClick={() => setCardPerson({ id: p.id, kind: p.kind, name: p.name, role: p.role })}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          color: 'inherit',
                          font: 'inherit',
                          fontWeight: 650,
                          textDecoration: 'underline',
                          textDecorationColor: 'var(--sk-line-2)',
                          textUnderlineOffset: 3,
                        }}
                        title="View monthly attendance"
                      >
                        {p.name}
                      </button>
                      <div className="meta">{p.kind === 'TEACHER' ? 'Teacher' : p.role ?? 'Staff'}</div>
                    </div>
                    <span className="sp" />
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {STATUSES.map((option) => {
                        const active = status === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setMarks((m) => ({ ...m, [k]: option }))}
                            style={{
                              borderRadius: 8,
                              padding: '6px 11px',
                              fontSize: 11.5,
                              fontWeight: 700,
                              cursor: 'pointer',
                              border: `1.5px solid ${active ? STATUS_COLOR[option] : 'var(--sk-line-2)'}`,
                              background: active ? STATUS_COLOR[option] : 'var(--sk-card)',
                              color: active ? '#fff' : 'var(--sk-ink-2)',
                              transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
                            }}
                          >
                            {STATUS_LABEL[option]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
