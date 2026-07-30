import { useCallback, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TimetableSlot } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { minutesOfDay } from '@/lib/teacher-day';
import { buildGrid, cellKey, type GridPeriodRow, type GridSlot } from '@/lib/timetable-grid';
import { DaySelector } from '@/components/DaySelector';
import { TimetableList, type TimetableRow } from '@/components/TimetableList';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

// `TimetableSlot` (`@skoolos/types`) is what GET /manage/timetable/mine
// returns — TimetableService.SLOT_INCLUDE, the SAME wire contract the web
// teacher grid (apps/web/app/teacher/timetable/page.tsx) and the student
// portal's timetable pages read via GET /me/timetable. One include, one
// shared type, every caller.
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

// ── Clock ────────────────────────────────────────────────────────────────
// Ported verbatim from apps/web/app/teacher/timetable/page.tsx so the phone
// and the browser never disagree about what "today" or "now" means. This
// screen reads the device's own local clock (getDay/getHours/getMinutes,
// NOT toISOString/getUTCDay, which would read the wrong calendar day
// whenever local and UTC disagree — see lib/attendance.ts's todayISO() for
// the same convention) and passes plain numbers/ids down to the two pure
// presentational components below; neither DaySelector nor TimetableList
// ever reads Date itself.

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
    }, []),
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
  const currentPeriodId = isViewingToday ? findCurrentPeriodId(shape.periods, nowMinutes()) : null;

  const rows: TimetableRow[] = shape.periods.map((period) => ({
    period,
    slot: selectedDay !== null ? (shape.cells.get(cellKey(selectedDay, period.id)) ?? null) : null,
  }));

  return (
    <Screen>
      <SectionTitle title="Timetable" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Your whole week — pick a day to see its periods.
      </Text>

      {slots === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading your timetable…</Text>
        </Card>
      )}

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}

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
          <TimetableList rows={rows} currentPeriodId={currentPeriodId} />
        </>
      )}
    </Screen>
  );
}
