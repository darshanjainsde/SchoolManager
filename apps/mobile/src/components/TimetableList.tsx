import { Text, View } from 'react-native';
import type { GridPeriodRow, GridSlot } from '@/lib/timetable-grid';
import { Card, Pill } from './ui';
import { useTokens } from '@/theme/theme-context';

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
}

/**
 * One day's timetable as a vertical list — periods top to bottom, in
 * `period.order`. Stands in for the web's `WeekGrid` row axis: a phone can
 * only comfortably show one day's periods at a time (see `DaySelector`'s
 * doc comment for why the day axis moved to a chip strip instead of staying
 * a table column), so this only ever renders whichever single day the
 * screen selected. A free period still gets its own row — dropping it would
 * make "nothing scheduled" indistinguishable from "the data didn't load".
 * Mirrors the fill-only-for-an-actual-class rule from
 * apps/web/components/timetable/WeekGrid.tsx: the "current" highlight never
 * applies to a free row, even if its period is the one happening right now.
 */
export function TimetableList({ rows, currentPeriodId }: TimetableListProps) {
  const tokens = useTokens();
  if (rows.length === 0) {
    return (
      <Card testID="timetable-list-empty">
        <Text style={{ color: tokens.color.sub }}>No periods scheduled this day.</Text>
      </Card>
    );
  }

  return (
    <Card testID="timetable-list" style={{ paddingVertical: 2 }}>
      {rows.map(({ period, slot }) => {
        const isCurrent = !!slot && period.id === currentPeriodId;
        const hasTime = !!(period.startTime || period.endTime);
        return (
          <View
            key={period.id}
            testID={`period-row-${period.id}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 11,
              borderBottomWidth: 1,
              borderBottomColor: tokens.color.line,
              backgroundColor: isCurrent ? tokens.color.indigo50 : 'transparent',
              marginHorizontal: isCurrent ? -14 : 0,
              paddingHorizontal: isCurrent ? 14 : 0,
              borderRadius: isCurrent ? tokens.radius.card : 0,
            }}
          >
            <View style={{ width: 96 }}>
              <Text style={{ fontSize: 11.5, color: tokens.color.sub, fontWeight: '600' }}>{period.label}</Text>
              {hasTime && (
                <Text style={{ fontSize: 10.5, color: tokens.color.sub, marginTop: 1 }}>
                  {period.startTime}
                  {period.startTime && period.endTime && ' – '}
                  {period.endTime}
                </Text>
              )}
            </View>

            {slot ? (
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: tokens.color.ink }} numberOfLines={1}>
                  {slot.className}
                </Text>
                <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 1 }} numberOfLines={1}>
                  {slot.subjectName}
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1 }} testID={`period-row-free-${period.id}`}>
                <Text style={{ fontSize: 12.5, color: tokens.color.sub, fontStyle: 'italic' }}>Free</Text>
              </View>
            )}

            {isCurrent && <Pill tone="indigo">Now</Pill>}
          </View>
        );
      })}
    </Card>
  );
}
