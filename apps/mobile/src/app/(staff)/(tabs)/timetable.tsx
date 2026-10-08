import { useReload } from '@/lib/query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TeacherDay, TimetableSlot } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { minutesOfDay } from '@/lib/teacher-day';
import { useNowMinutes } from '@/lib/use-now-minutes';
import { buildGrid, cellKey, toGridSlot, type GridPeriodRow } from '@/lib/timetable-grid';
import { DaySelector } from '@/components/DaySelector';
import { TimetableList, type TimetableRow } from '@/components/TimetableList';
import { Card, ErrorState, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';

// ── Clock ────────────────────────────────────────────────────────────────
// Ported verbatim from apps/web/app/teacher/timetable/page.tsx so the phone
// and the browser never disagree about what "today" or "now" means. This
// screen reads the device's own local clock (getDay/getHours/getMinutes,
// NOT toISOString/getUTCDay, which would read the wrong calendar day
// whenever local and UTC disagree — see lib/attendance.ts's todayISO() for
// the same convention) and passes plain numbers/ids down to the two pure
// presentational components below; TimetableList never reads Date itself.
//
// The repaint: the day axis is the pitch's `.dstrip` (a strip of torn-off date
// cells) and the periods are `RailRow`s on a `Page` — the shared `.rowln` with
// its red margin rule, the same object the teacher's own day rail and the
// family timetable are drawn from. Both live in the shared DaySelector /
// TimetableList, so the teacher's week and the student's week are one design
// with one set of rules, not two that drift.

/** ISO weekday matching TimetableSlot.dayOfWeek: 1 = Mon … 7 = Sun. */
function todayDayOfWeek(): number {
  const js = new Date().getDay(); // 0 = Sun … 6 = Sat
  return js === 0 ? 7 : js;
}

/**
 * The local calendar date (YYYY-MM-DD) of `dayOfWeek` in the CURRENT week —
 * the week the day strip shows. Local fields, never toISOString (see above).
 */
export function dateOfWeekday(dayOfWeek: number, today: Date = new Date()): string {
  const js = today.getDay();
  const todayDow = js === 0 ? 7 : js;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (dayOfWeek - todayDow));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The selected day's rows, from the SAME source the teacher's Home reads
 * (`/manage/timetable/my-day`): every period the school runs that day,
 * breaks and free periods included, plus any cover. Built from the week's own
 * slots alone, a period the teacher never teaches in all week (VII) and every
 * break simply vanished, so Timetable and Home disagreed about today
 * (re-audit 2026-10-08).
 */
export function rowsFromDay(day: TeacherDay): TimetableRow[] {
  return day.entries.map((e, i) => {
    const period: GridPeriodRow = { id: e.periodId, label: e.label, startTime: e.startTime, endTime: e.endTime, order: i };
    if (e.kind === 'BREAK') return { period, slot: null, kind: 'BREAK' as const };
    const slot = e.kind === 'CLASS' && e.slot
      ? {
          id: `${day.date}:${e.periodId}`,
          dayOfWeek: day.dayOfWeek,
          periodId: e.periodId,
          periodLabel: e.label,
          startTime: e.startTime,
          endTime: e.endTime,
          periodOrder: i,
          className: e.slot.className,
          subjectName: e.slot.covering ? `${e.slot.subjectName} · cover` : e.slot.subjectName,
        }
      : null;
    return { period, slot };
  });
}

/**
 * The period whose [startTime, endTime) window contains `now`, or null.
 * Mirrors `currentEntry`'s "a period owns its start minute, not its end
 * minute" rule (lib/teacher-day.ts) — reusing `minutesOfDay` for the HH:MM
 * math — but written against `GridPeriodRow` rather than `currentEntry`
 * directly: unlike `TeacherDayEntry`, a period row's start/end time are
 * optional (a period the school never gave clock times still gets a row),
 * so a period with no times can never be "current" rather than crashing on
 * undefined.
 */
function findCurrentPeriodId(periods: GridPeriodRow[], now: number): string | null {
  const found = periods.find(
    (p) => p.startTime && p.endTime && now >= minutesOfDay(p.startTime) && now < minutesOfDay(p.endTime),
  );
  return found?.id ?? null;
}

export default function Timetable() {
  const tokens = useTokens();
  // Try again / pull-to-refresh for this screen's own focus effect.
  const [reloadKey, reload] = useReload();
  const [slots, setSlots] = useState<TimetableSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The teacher's own tap overrides the default day; null means "no
  // override yet, use whatever the clock says". A picked day that no longer
  // exists in this week's shape (a fresh fetch after re-focus dropped it)
  // also falls back to the default rather than pointing at nothing.
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  // Refetch on focus — an admin editing the timetable while the app is
  // backgrounded should show up without a manual pull-to-refresh, same as
  // holidays.tsx.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<TimetableSlot[]>('/manage/timetable/mine')
        .then((data) => {
          if (!cancelled) setSlots(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, [reloadKey]),
  );

  const shape = useMemo(() => buildGrid((slots ?? []).map(toGridSlot)), [slots]);
  const todayDow = todayDayOfWeek();
  // Today preselected whenever this teacher actually has a timetable on
  // today; otherwise the first day they do have (e.g. opening the app on a
  // Sunday with no Sunday classes) — never a day with no data in this
  // shape, and never a crash pointing at a day column that doesn't exist.
  const defaultDay = shape.days.includes(todayDow) ? todayDow : (shape.days[0] ?? null);
  const selectedDay = pickedDay !== null && shape.days.includes(pickedDay) ? pickedDay : defaultDay;
  const isViewingToday = selectedDay !== null && selectedDay === todayDow;
  // Ticks on the minute — the "now" rule moves down the day on its own
  // rather than freezing wherever the screen happened to be opened.
  const now = useNowMinutes();

  // The selected day, read the way Home reads it. Until it lands (or if it
  // fails) the week's own rows stand in, so the list never blinks empty.
  const [day, setDay] = useState<TeacherDay | null>(null);
  const selectedDate = selectedDay !== null ? dateOfWeekday(selectedDay) : null;
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    api
      .request<TeacherDay>(`/manage/timetable/my-day?date=${encodeURIComponent(selectedDate)}`)
      .then((d) => {
        if (!cancelled) setDay(d);
      })
      .catch(() => {
        if (!cancelled) setDay(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, reloadKey]);

  const weekRows: TimetableRow[] = shape.periods.map((period) => ({
    period,
    slot: selectedDay !== null ? (shape.cells.get(cellKey(selectedDay, period.id)) ?? null) : null,
  }));
  const rows: TimetableRow[] = day && day.date === selectedDate && day.entries.length > 0 ? rowsFromDay(day) : weekRows;
  const currentPeriodId = isViewingToday ? findCurrentPeriodId(rows.filter((r) => r.kind !== 'BREAK').map((r) => r.period), now) : null;

  return (
    <Screen onRefresh={reload}>
      <SectionTitle title="Timetable" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Your whole week — pick a day to see its periods.
      </Text>

      {slots === null && !error && (
        <LoadingRows label="Loading your timetable…" rows={6} />
      )}

      {error && <ErrorState error={error} onRetry={reload} />}

      {slots !== null && !error && slots.length === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            No timetable has been set up for you yet — ask your school admin.
          </Text>
        </Card>
      )}

      {slots !== null && !error && slots.length > 0 && selectedDay !== null && (
        <>
          <DaySelector
            days={shape.days}
            selectedDay={selectedDay}
            todayDayOfWeek={shape.days.includes(todayDow) ? todayDow : null}
            onSelect={setPickedDay}
          />
          {/* `nowMinutes` only while the day on screen is actually today —
              that is what lets a finished period drop to .55 without claiming
              that Friday's periods are over when read on a Monday. */}
          <TimetableList
            rows={rows}
            currentPeriodId={currentPeriodId}
            nowMinutes={isViewingToday ? now : null}
          />
        </>
      )}
    </Screen>
  );
}
