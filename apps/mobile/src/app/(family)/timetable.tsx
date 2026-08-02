import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TimetableSlot } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { minutesOfDay } from '@/lib/teacher-day';
import { buildGrid, cellKey, toGridSlot, type GridPeriodRow } from '@/lib/timetable-grid';
import { Card, Empty, Page, RailRow, RailStatus, Screen, SectionTitle, type RailState } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

// The student's own weekly timetable. `GET /me/timetable`
// (PortalService.timetable -> TimetableService.listForClass) returns the
// EXACT SAME `TimetableSlot[]` wire shape as `GET /manage/timetable/mine` —
// see the doc comment on `TimetableSlot` in packages/types/src/index.ts
// ("One include, one contract, three callers") — so this screen still reuses
// `toGridSlot`/`buildGrid` verbatim rather than forking them.
//
// What changed with the repaint: the day axis is now the pitch's `.dstrip`
// (a strip of torn-off date cells) and the periods are `RailRow`s on a
// `Page` — the shared `.rowln` with its red margin rule, the same object the
// family home and the teacher's day are drawn from. The old chip-strip +
// `TimetableList` pairing stays where it still belongs, on `(staff)`.

const DAY_LABELS: Record<number, string> = {
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
  7: 'SUN',
};

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
 * Day-of-month for `dow` in the week the device is currently in — the serif
 * numeral on each `.day` cell. The numeral is what makes the strip read as
 * torn from a calendar rather than as a row of filter chips, which is why the
 * pitch sets it in the book face and not in the UI sans.
 */
function dateOfWeekday(dow: number): number {
  const now = new Date();
  const shifted = new Date(now);
  shifted.setDate(now.getDate() + (dow - todayDayOfWeek()));
  return shifted.getDate();
}

/** The period whose [startTime, endTime) window contains `now`, or null — see (staff)/timetable.tsx for the full rationale. */
function findCurrentPeriodId(periods: GridPeriodRow[], now: number): string | null {
  const found = periods.find(
    (p) => p.startTime && p.endTime && now >= minutesOfDay(p.startTime) && now < minutesOfDay(p.endTime),
  );
  return found?.id ?? null;
}

/**
 * The `.dstrip` — a horizontally scrolling strip of 44px `.day` cells:
 * uppercase weekday over a serif date.
 *
 * `.sel` fills indigo; `.today` (when it is not the selected day) is outlined
 * in amber. Two independent signals on the same cell, deliberately: a student
 * can read Friday's page on a Monday, and it must stay obvious which day it
 * actually is while they do.
 */
function DayStrip({
  days,
  selectedDay,
  todayDow,
  onSelect,
}: {
  days: number[];
  selectedDay: number | null;
  todayDow: number | null;
  onSelect: (day: number) => void;
}) {
  const tokens = useTokens();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 2, paddingVertical: 4 }}
    >
      {days.map((day) => {
        const selected = day === selectedDay;
        const isToday = day === todayDow;
        return (
          <Pressable
            key={day}
            testID={`day-chip-${day}`}
            accessibilityRole="button"
            accessibilityLabel={`${DAY_LABELS[day] ?? `Day ${day}`}${isToday ? ', today' : ''}`}
            accessibilityState={{ selected }}
            onPress={() => onSelect(day)}
            style={{
              width: 44,
              alignItems: 'center',
              borderWidth: 1,
              borderRadius: 11,
              paddingTop: 6,
              paddingBottom: 7,
              backgroundColor: selected
                ? tokens.color.indigo
                : isToday
                  ? tokens.color.amber50
                  : tokens.color.surface,
              borderColor: selected ? tokens.color.indigo : isToday ? tokens.color.amber : tokens.color.line,
            }}
          >
            <Text
              style={{
                fontSize: 8.5,
                fontWeight: '800',
                letterSpacing: 0.5,
                color: selected ? tokens.color.onBrand : isToday ? tokens.color.late : tokens.color.sub,
              }}
            >
              {DAY_LABELS[day] ?? `D${day}`}
            </Text>
            <Text
              style={{
                fontFamily: font.serif,
                fontSize: 15,
                marginTop: 1,
                color: selected ? tokens.color.onBrand : isToday ? tokens.color.late : tokens.color.ink,
              }}
            >
              {dateOfWeekday(day)}
            </Text>
            {isToday && (
              // The amber bead that says "this one is today" — its own node
              // (and its own testID) so the signal survives the cell being
              // selected, filled indigo, and losing its amber outline.
              <View
                testID={`day-chip-today-label-${day}`}
                accessibilityLabel="Today"
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  marginTop: 3,
                  backgroundColor: selected ? tokens.color.onBrand : tokens.color.amber,
                }}
              />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
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
          <DayStrip
            days={shape.days}
            selectedDay={selectedDay}
            todayDow={shape.days.includes(todayDow) ? todayDow : null}
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
