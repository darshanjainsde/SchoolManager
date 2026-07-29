'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react';
import type { AttendanceStatusValue, AttendanceSummary } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/cn';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Monday-first, to match the timetable's day ordering. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_STYLES: Record<AttendanceStatusValue, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ABSENT: 'bg-rose-100 text-rose-800 border-rose-200',
  LATE: 'bg-amber-100 text-amber-800 border-amber-200',
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
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Attendance</h1>
        <p className="mt-1 text-sm text-slate-500">Your day-by-day attendance record.</p>
      </header>

      {/* Month picker */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          aria-label="Previous month"
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        <p className="text-base font-semibold text-slate-900" aria-live="polite">
          {monthLabel(month)}
        </p>

        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={atLatestMonth}
          aria-label="Next month"
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading attendance…</p>}
      {error && <p className="text-sm text-rose-500">{(error as Error).message}</p>}

      {!isLoading && !error && data && (
        <div
          aria-busy={isPlaceholderData}
          className={cn('flex flex-col gap-6 transition-opacity', isPlaceholderData && 'opacity-50')}
        >
          {/* Month summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">This month</CardTitle>
            </CardHeader>
            <CardContent>
              {marked === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <CalendarCheck className="h-10 w-10 text-slate-300" />
                  <p className="text-sm text-slate-400">
                    No attendance recorded yet for {monthLabel(month)}.
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <p className="text-3xl font-bold text-slate-900">{data.percent}%</p>
                    <p className="text-xs text-slate-500">
                      present across {marked} recorded {marked === 1 ? 'day' : 'days'}
                    </p>
                  </div>
                  <dl className="flex flex-wrap gap-3 text-sm">
                    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center">
                      <dt className="text-xs font-medium text-emerald-700">Present</dt>
                      <dd className="text-lg font-bold text-emerald-800">{data.present}</dd>
                    </div>
                    <div className="rounded-lg bg-rose-50 px-3 py-2 text-center">
                      <dt className="text-xs font-medium text-rose-700">Absent</dt>
                      <dd className="text-lg font-bold text-rose-800">{data.absent}</dd>
                    </div>
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-center">
                      <dt className="text-xs font-medium text-amber-700">Late</dt>
                      <dd className="text-lg font-bold text-amber-800">{data.late}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Month calendar */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{monthLabel(month)}</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="grid grid-cols-7 gap-1.5"
                aria-label={`Attendance calendar for ${monthLabel(month)}`}
              >
                {WEEKDAY_LABELS.map((label) => (
                  <div
                    key={label}
                    aria-hidden="true"
                    className="pb-1 text-center text-xs font-medium text-slate-400"
                  >
                    {label}
                  </div>
                ))}

                {cells.map((dayNum, i) => {
                  if (dayNum === null) {
                    return <div key={`blank-${i}`} aria-hidden="true" />;
                  }
                  const date = `${month}-${String(dayNum).padStart(2, '0')}`;
                  const status = statusByDate.get(date);
                  const isToday = date === today;
                  return (
                    <div
                      key={date}
                      aria-label={`${date}: ${status ? STATUS_LABELS[status] : 'no record'}`}
                      className={cn(
                        'flex aspect-square items-center justify-center rounded-md border text-xs font-medium',
                        status
                          ? STATUS_STYLES[status]
                          : 'border-slate-100 bg-slate-50 text-slate-400',
                        isToday && 'ring-2 ring-teal-500 ring-offset-1',
                      )}
                    >
                      {dayNum}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <ul className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
                {(Object.keys(STATUS_LABELS) as AttendanceStatusValue[]).map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span className={cn('h-3 w-3 rounded border', STATUS_STYLES[s])} />
                    {STATUS_LABELS[s]}
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded border border-slate-100 bg-slate-50" />
                  No record
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
