'use client';
import { useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react';
import type { AttendanceStatusValue, AttendanceSummary } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { cn } from '@/lib/cn';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Monday-first, to match the timetable's day ordering. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The tally boxes and the legend swatches. The calendar cells themselves are
 * painted by `.sk-cell[data-att]` in sk-theme.css — the two must agree, which
 * is why both sides read the same three semantic token pairs.
 *
 * LATE takes `--sk-amber-ink`, not `--sk-amber`: #f59e0b on its own #fde9c8
 * tint is about 1.8:1 and unreadable. Amber is the fill; amber-ink is the
 * writing that goes on it.
 */
const STATUS_STYLES: Record<AttendanceStatusValue, CSSProperties> = {
  PRESENT: { background: 'var(--sk-good-tint)', color: 'var(--sk-good)', borderColor: 'var(--sk-good)' },
  ABSENT: { background: 'var(--sk-bad-tint)', color: 'var(--sk-bad)', borderColor: 'var(--sk-bad)' },
  LATE: { background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)', borderColor: 'var(--sk-amber)' },
};

const STATUS_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `YYYY-MM` for the given local date. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` for the given local date. */
function dayKey(d: Date): string {
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Shift a `YYYY-MM` key by `delta` months, wrapping the year correctly. */
function shiftMonth(key: string, delta: number): string {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1 + delta;
  return monthKey(new Date(year, monthIndex, 1));
}

function monthLabel(key: string): string {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1;
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function daysInMonth(key: string): number {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1;
  // Day 0 of the *next* month is the last day of this one.
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** How many blank cells precede the 1st, in a Monday-first grid. */
function leadingBlanks(key: string): number {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1;
  return (new Date(year, monthIndex, 1).getDay() + 6) % 7;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalAttendancePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(thisMonth);
  const today = dayKey(new Date());

  const { data, isLoading, error, isPlaceholderData } = useQuery({
    queryKey: ['portal-attendance', month],
    queryFn: () => api.get<AttendanceSummary>(`/me/attendance?month=${month}`),
    enabled: !!host,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const statusByDate = new Map<string, AttendanceStatusValue>(
    (data?.days ?? []).map((d) => [d.date, d.status]),
  );
  const marked = data ? data.present + data.absent + data.late : 0;

  // Looking further ahead than the current month can only ever show blanks.
  const atLatestMonth = month >= thisMonth;

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks(month) }, () => null),
    ...Array.from({ length: daysInMonth(month) }, (_, i) => i + 1),
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Attendance</h1>
        <p>Your day-by-day attendance record.</p>
      </header>

      {/* Month picker */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          aria-label="Previous month"
          className="sk-btn"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        <p className="text-base font-semibold" style={{ color: 'var(--sk-ink)' }} aria-live="polite">
          {monthLabel(month)}
        </p>

        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={atLatestMonth}
          aria-label="Next month"
          className="sk-btn"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {isLoading && <p className="sk-state">Loading attendance…</p>}
      {error && <p className="sk-state err">{(error as Error).message}</p>}

      {!isLoading && !error && data && (
        <div
          aria-busy={isPlaceholderData}
          className={cn('flex flex-col gap-6 transition-opacity', isPlaceholderData && 'opacity-50')}
        >
          {/* ── Month summary ──────────────────────────────────────────────
              The pitch's `.attkpi`: one big monospace figure and a quiet
              label. This page is asked exactly one question — "what is the
              percentage" — so the answer is the largest thing on it, and it
              is set in the register's face because it is a figure that moves
              month to month, not a heading. */}
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>This month</h3>
            </div>
            <div className="sk-card-b">
              {marked === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <CalendarCheck className="h-10 w-10" style={{ color: 'var(--sk-ink-3)' }} />
                  <p className="sk-state">No attendance recorded yet for {monthLabel(month)}.</p>
                </div>
              ) : (
                <div>
                  <div className="sk-attkpi">
                    <span className="n">{data.percent}%</span>
                    <span className="l">
                      present across {marked} recorded {marked === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  {/* THE INK LINE — the month filling up like a pen stroke.
                      The width is the real percentage, so the bar is correct
                      whether or not the animation ever runs. */}
                  <div className="sk-attink">
                    <i className="sk-inkline" style={{ width: `${data.percent}%` }} />
                  </div>
                  <dl className="mt-4 flex flex-wrap gap-3 text-sm">
                    {(
                      [
                        ['PRESENT', data.present],
                        ['ABSENT', data.absent],
                        ['LATE', data.late],
                      ] as [AttendanceStatusValue, number][]
                    ).map(([status, count]) => (
                      <div
                        key={status}
                        className="rounded-lg px-3 py-2 text-center"
                        style={{ background: STATUS_STYLES[status].background }}
                      >
                        <dt className="text-xs font-medium" style={{ color: STATUS_STYLES[status].color }}>
                          {STATUS_LABELS[status]}
                        </dt>
                        <dd className="text-lg font-bold" style={{ color: STATUS_STYLES[status].color }}>
                          {count}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>

          {/* ── Month calendar ─────────────────────────────────────────────
              Tinted cells rather than icons, so the shape of the month reads
              as a pattern at a glance. A day with no record stays an outline:
              "not marked" must never be mistakable for "present". */}
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>{monthLabel(month)}</h3>
            </div>
            <div className="sk-card-b">
              <div className="sk-cal" aria-label={`Attendance calendar for ${monthLabel(month)}`}>
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} aria-hidden="true" className="wd">
                    {label}
                  </div>
                ))}

                {cells.map((dayNum, i) => {
                  if (dayNum === null) {
                    return <div key={`blank-${i}`} aria-hidden="true" />;
                  }
                  const date = `${month}-${String(dayNum).padStart(2, '0')}`;
                  const status = statusByDate.get(date);
                  return (
                    <div
                      key={date}
                      className="sk-cell"
                      data-att={status ?? 'none'}
                      data-today={date === today}
                      aria-label={`${date}: ${status ? STATUS_LABELS[status] : 'no record'}`}
                    >
                      {dayNum}
                    </div>
                  );
                })}
              </div>

              {/* Legend — the swatches are the same token pairs the cells use,
                  so what the key says is what the grid shows. */}
              <ul className="sk-legend">
                {(Object.keys(STATUS_LABELS) as AttendanceStatusValue[]).map((s) => (
                  <li key={s}>
                    <b style={{ background: STATUS_STYLES[s].background }} />
                    {STATUS_LABELS[s]}
                  </li>
                ))}
                <li>
                  <b style={{ background: 'var(--sk-paper)', border: '1px solid var(--sk-line)' }} />
                  No record
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
