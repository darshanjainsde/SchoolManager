import { Pressable, Text, View } from 'react-native';
import { tokens } from '@/theme/tokens';

const DAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export interface DaySelectorProps {
  /** Day columns actually in this teacher's timetable, ascending — from `GridShape.days`. */
  days: number[];
  /** The day currently shown below the strip. */
  selectedDay: number | null;
  /** 1-7, or null when today is not a school day in this grid (e.g. Sunday). */
  todayDayOfWeek: number | null;
  onSelect: (day: number) => void;
}

/**
 * Mon–Sat (or whichever days this teacher actually teaches — a school that
 * never runs Sunday never gets a Sunday chip, mirroring `WeekGrid` dropping
 * empty day columns) chip strip standing in for the web's day-column
 * headers. A phone screen at 360px can't show a 6-column table (the web
 * layout) and stay legible, so the day axis moves here and the period axis
 * becomes a vertical list (`TimetableList`) for whichever one day is
 * selected. "Today" and "selected" are two independent signals on the same
 * chip — the teacher can browse Wednesday's timetable on a Monday, and it
 * must still be obvious which chip is actually today.
 */
export function DaySelector({ days, selectedDay, todayDayOfWeek, onSelect }: DaySelectorProps) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {days.map((day) => {
        const isSelected = day === selectedDay;
        const isToday = day === todayDayOfWeek;
        return (
          <Pressable
            key={day}
            testID={`day-chip-${day}`}
            onPress={() => onSelect(day)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            style={{
              borderWidth: 1.5,
              borderColor: isSelected ? tokens.color.indigo : isToday ? tokens.color.indigo : tokens.color.line,
              backgroundColor: isSelected ? tokens.color.indigo : isToday ? tokens.color.indigo50 : tokens.color.surface,
              borderRadius: tokens.radius.chip,
              paddingVertical: 9,
              paddingHorizontal: 14,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                fontSize: 12.5,
                fontWeight: '700',
                color: isSelected ? '#fff' : isToday ? tokens.color.indigo : tokens.color.sub,
              }}
            >
              {DAY_LABELS[day] ?? `Day ${day}`}
            </Text>
            {isToday && (
              <Text
                testID={`day-chip-today-label-${day}`}
                style={{
                  fontSize: 9,
                  fontWeight: '700',
                  marginTop: 1,
                  color: isSelected ? '#fff' : tokens.color.indigo,
                }}
              >
                Today
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
