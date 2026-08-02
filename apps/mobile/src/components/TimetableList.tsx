import { View } from 'react-native';
import type { GridPeriodRow, GridSlot } from '@/lib/timetable-grid';
import { minutesOfDay } from '@/lib/teacher-day';
import { Empty, Page, RailRow, RailStatus, type RailState } from './ui';

export interface TimetableRow {
  period: GridPeriodRow;
  /** The slot in this row's day+period cell, or null for a free period. */
  slot: GridSlot | null;
}

export interface TimetableListProps {
  rows: TimetableRow[];
  /**
   * Period id happening right now, or null. The caller (the screen) is
   * responsible for only ever passing a non-null id when the day being
   * shown is actually today — this component has no clock and does not
   * re-derive "is this today" itself.
   */
  currentPeriodId: string | null;
  /**
   * Minutes-of-day on the device's clock, but ONLY when the day being shown is
   * today; omitted (or null) means "some other day", and then no row is dimmed.
   *
   * Optional for the same reason `currentPeriodId` is a prop: the clock stays
   * the screen's business. Without it this list simply never draws the finished
   * state, which is the correct reading of a day that is not in progress —
   * Friday's periods are not "over" when you look at them on a Monday.
   */
  nowMinutes?: number | null;
}

/**
 * One day's timetable as a page of ruled rows (`.rowln` on `.page`) — periods
 * top to bottom, in `period.order`.
 *
 * Stands in for the web's `WeekGrid` row axis: a phone can only comfortably
 * show one day's periods at a time (see `DaySelector` for why the day axis
 * moved to a date strip), so this only ever renders whichever single day the
 * screen selected. A free period still gets its own row — dropping it would
 * make "nothing scheduled" indistinguishable from "the data didn't load".
 *
 * The row anatomy comes from `RailRow`, the shared object the family home and
 * the teacher's day are also drawn from: a mono time column in the margin, the
 * red margin rule, and then the lesson in the body. What the row is doing to
 * the day decides how it is inked — the live period takes the amber highlighter
 * wash, a free period the green one, a finished period drops to .55 so it stays
 * readable as the record of the day without competing with what is happening
 * now. Mirrors the fill-only-for-an-actual-class rule from
 * apps/web/components/timetable/WeekGrid.tsx: the "current" highlight never
 * applies to a free row, even if its period is the one happening right now.
 *
 * A teacher's row leads with the CLASS and follows with the subject (a teacher
 * teaches one subject to many classes, so the class is the thing that changes
 * period to period). The student's timetable inverts that on its own screen for
 * the mirrored reason.
 */
export function TimetableList({ rows, currentPeriodId, nowMinutes }: TimetableListProps) {
  if (rows.length === 0) {
    return (
      <Page testID="timetable-list-empty">
        <Empty>No periods scheduled this day.</Empty>
      </Page>
    );
  }

  return (
    <Page testID="timetable-list">
      {rows.map(({ period, slot }, i) => {
        const isCurrent = !!slot && period.id === currentPeriodId;
        const isPast =
          nowMinutes != null && !isCurrent && !!period.endTime && nowMinutes >= minutesOfDay(period.endTime);
        const state: RailState = isCurrent ? 'now' : !slot ? 'free' : isPast ? 'done' : 'upcoming';
        return (
          <RailRow
            key={period.id}
            testID={`period-row-${period.id}`}
            first={i === 0}
            state={state}
            // A period the school never gave clock times still gets a row, and
            // its margin falls back to the label the school did give it — never
            // to the word "undefined".
            startTime={period.startTime ?? period.label}
            endTime={period.endTime ?? ''}
            title={slot ? slot.className : 'Free'}
            subtitle={slot ? slot.subjectName : undefined}
            right={
              isCurrent ? (
                <RailStatus tone="now">Now</RailStatus>
              ) : slot ? undefined : (
                // A free period keeps its own marker node so a caller (or a
                // test) can find the gap itself, not just the word in the row.
                <View testID={`period-row-free-${period.id}`} />
              )
            }
          />
        );
      })}
    </Page>
  );
}
