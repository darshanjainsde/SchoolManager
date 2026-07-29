'use client';
import { useQuery } from '@tanstack/react-query';
import type { TimetableSlot } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { buildGrid, type GridSlot, type GridPeriodRow } from '@/lib/timetable-grid';
import { minutesOfDay } from '@/lib/teacher-day';
import { WeekGrid } from '@/components/timetable/WeekGrid';

// `TimetableSlot` (`@skoolos/types`) is what GET /manage/timetable/mine
// returns — TimetableService.SLOT_INCLUDE, the SAME wire contract the
// student portal's timetable pages read via GET /me/timetable. One include,
// one shared type, both callers.

function toGridSlot(s: TimetableSlot): GridSlot {
  return {
    id: s.id,
    dayOfWeek: s.dayOfWeek,
    periodId: s.period.id,
    periodLabel: s.period.label,
    startTime: s.period.startTime,
    endTime: s.period.endTime,
    periodOrder: s.period.order,
    className: `${s.classSection.grade.name}-${s.classSection.name}`,
    subjectName: s.subject.name,
  };
}

// ── Clock ────────────────────────────────────────────────────────────────────
// WeekGrid itself never reads Date — this page computes "what day/period is
// it" from the browser's own local clock (getDay/getHours/getMinutes, not
// toISOString/getUTCDay, which would read the wrong calendar day whenever
// local and UTC disagree — see teacher/page.tsx's todayIso() for the same
// convention) and passes plain numbers/ids down.

/** ISO weekday matching TimetableSlot.dayOfWeek: 1 = Mon … 7 = Sun. */
function todayDayOfWeek(): number {
  const js = new Date().getDay(); // 0 = Sun … 6 = Sat
  return js === 0 ? 7 : js;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The period whose [startTime, endTime) window contains `now`, or null.
 * Mirrors `currentEntry`'s "a period owns its start minute, not its end
 * minute" rule (lib/teacher-day.ts) — reusing `minutesOfDay` for the HH:MM
 * math — but written against `GridPeriodRow` rather than `currentEntry`
 * directly: unlike `TeacherDayEntry`, a period row's start/end time are
 * optional (a period the school never gave clock times still gets a grid
 * row), so a period with no times can never be "current" rather than
 * crashing on undefined.
 */
function findCurrentPeriodId(periods: GridPeriodRow[], now: number): string | null {
  const found = periods.find(
    (p) => p.startTime && p.endTime && now >= minutesOfDay(p.startTime) && now < minutesOfDay(p.endTime),
  );
  return found?.id ?? null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TeacherTimetablePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const week = useQuery({
    queryKey: ['t-my-week'],
    enabled: !!host,
    queryFn: () => api.get<TimetableSlot[]>('/manage/timetable/mine'),
  });

  const slots = (week.data ?? []).map(toGridSlot);
  const shape = buildGrid(slots);

  const dow = todayDayOfWeek();
  // null when today isn't a day this teacher is taught at all (e.g. a school
  // that doesn't run Sunday) — WeekGrid then tints nothing, which is correct:
  // there is no "today" column to point at.
  const todayColumn = shape.days.includes(dow) ? dow : null;
  const currentPeriodId = todayColumn !== null ? findCurrentPeriodId(shape.periods, nowMinutes()) : null;

  return (
    <>
      <header className="sk-pagehead">
        <h1>Timetable</h1>
        <p>Your whole week in one view — today&apos;s column is highlighted.</p>
      </header>

      {week.isLoading && <p className="sk-state">Loading your timetable…</p>}
      {week.error && <p className="sk-state err">{(week.error as Error).message}</p>}

      {!week.isLoading && !week.error && slots.length === 0 && (
        <p className="sk-state">No timetable has been set up for you yet — ask your school admin.</p>
      )}

      {!week.isLoading && !week.error && slots.length > 0 && (
        <WeekGrid shape={shape} todayDayOfWeek={todayColumn} currentPeriodId={currentPeriodId} />
      )}
    </>
  );
}
