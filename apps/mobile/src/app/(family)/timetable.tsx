import { useCallback, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TimetableSlot } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { minutesOfDay } from '@/lib/teacher-day';
import { buildGrid, cellKey, toGridSlot, type GridPeriodRow } from '@/lib/timetable-grid';
import { DaySelector } from '@/components/DaySelector';
import { TimetableList, type TimetableRow } from '@/components/TimetableList';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

// The student's own weekly timetable. `GET /me/timetable`
// (PortalService.timetable -> TimetableService.listForClass) returns the
// EXACT SAME `TimetableSlot[]` wire shape as `GET /manage/timetable/mine` —
// see the doc comment on `TimetableSlot` in packages/types/src/index.ts
// ("One include, one contract, three callers") — so this screen reuses
// `toGridSlot`/`buildGrid`/`DaySelector`/`TimetableList` from the staff
// timetable ((staff)/timetable.tsx) verbatim rather than forking them or
// writing a new mapper; only the endpoint and the empty-state copy differ.

/** ISO weekday matching TimetableSlot.dayOfWeek: 1 = Mon … 7 = Sun. */
function todayDayOfWeek(): number {
  const js = new Date().getDay(); // 0 = Sun … 6 = Sat
  return js === 0 ? 7 : js;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** The period whose [startTime, endTime) window contains `now`, or null — see (staff)/timetable.tsx for the full rationale. */
function findCurrentPeriodId(periods: GridPeriodRow[], now: number): string | null {
  const found = periods.find(
    (p) => p.startTime && p.endTime && now >= minutesOfDay(p.startTime) && now < minutesOfDay(p.endTime),
  );
  return found?.id ?? null;
}

export default function Timetable() {
  const tokens = useTokens();
  const [slots, setSlots] = useState<TimetableSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  // Refetch on focus, same convention as every other family screen.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<TimetableSlot[]>('/me/timetable')
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
  // Today preselected whenever the student has a class today; otherwise the
  // first day they do have — never a day with no data in this shape.
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
            No timetable has been set up for your class yet — check back later.
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
