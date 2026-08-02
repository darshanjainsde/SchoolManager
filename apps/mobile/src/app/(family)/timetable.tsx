import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TimetableSlot } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { minutesOfDay } from '@/lib/teacher-day';
import { buildGrid, cellKey, toGridSlot, type GridPeriodRow } from '@/lib/timetable-grid';
import { DaySelector } from '@/components/DaySelector';
import { Card, Empty, Page, RailRow, RailStatus, Screen, SectionTitle, type RailState } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

// The student's own weekly timetable. `GET /me/timetable`
// (PortalService.timetable -> TimetableService.listForClass) returns the
// EXACT SAME `TimetableSlot[]` wire shape as `GET /manage/timetable/mine` —
// see the doc comment on `TimetableSlot` in packages/types/src/index.ts
// ("One include, one contract, three callers") — so this screen still reuses
// `toGridSlot`/`buildGrid` verbatim rather than forking them.
//
// What changed with the repaint: the day axis is now the pitch's `.dstrip`
// (a strip of torn-off date cells, the shared `DaySelector`) and the periods
// are `RailRow`s on a `Page` — the shared `.rowln` with its red margin rule,
// the same object the family home and the teacher's day are drawn from.
//
// The rows stay written out here rather than reusing `TimetableList` for ONE
// reason: a student's row leads with the SUBJECT (their class never changes,
// their subject changes every period), and a teacher's leads with the CLASS
// (their subject never changes, their class does). Same anatomy, opposite
// emphasis — a shared component would have to take a flag that means "whose
// timetable is this", which is the screen's own knowledge.

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
  const now = nowMinutes();
  const currentPeriodId = isViewingToday ? findCurrentPeriodId(shape.periods, now) : null;

  const rows = shape.periods.map((period) => ({
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

          {rows.length === 0 ? (
            <Page testID="timetable-list-empty">
              <Empty>No periods scheduled this day.</Empty>
            </Page>
          ) : (
            <Page testID="timetable-list">
              {rows.map(({ period, slot }, i) => {
                // Mirrors the fill-only-for-an-actual-class rule from
                // apps/web/components/timetable/WeekGrid.tsx: the live
                // highlight never applies to a free row, even when its period
                // is the one happening right now.
                const isCurrent = !!slot && period.id === currentPeriodId;
                const isPast =
                  isViewingToday && !isCurrent && !!period.endTime && now >= minutesOfDay(period.endTime);
                // `done` is the pitch's finished row: still readable (it is
                // the record of the day) but at .55, so it stops competing
                // with the period that is actually live.
                const state: RailState = isCurrent ? 'now' : !slot ? 'free' : isPast ? 'done' : 'upcoming';
                return (
                  <RailRow
                    key={period.id}
                    testID={`period-row-${period.id}`}
                    first={i === 0}
                    state={state}
                    startTime={period.startTime ?? period.label}
                    endTime={period.endTime ?? ''}
                    title={slot ? slot.subjectName : 'Free'}
                    subtitle={slot ? slot.className : undefined}
                    right={
                      isCurrent ? (
                        <RailStatus tone="now">Now</RailStatus>
                      ) : slot ? undefined : (
                        // A free period keeps its own marker node so the
                        // testID contract this screen shipped with survives
                        // the move off `TimetableList`.
                        <View testID={`period-row-free-${period.id}`} />
                      )
                    }
                  />
                );
              })}
            </Page>
          )}
        </>
      )}
    </Screen>
  );
}
