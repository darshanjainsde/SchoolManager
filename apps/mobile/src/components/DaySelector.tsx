import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

// The pitch writes the weekday in small caps above the date, so the labels are
// stored uppercase rather than being upper-cased at render time — the string
// that ships is the string a screen reader reads out.
const DAY_LABELS: Record<number, string> = {
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
  7: 'SUN',
};

/** ISO weekday for the device's own local today: 1 = Mon … 7 = Sun. */
function todayDayOfWeekLocal(): number {
  const js = new Date().getDay(); // 0 = Sun … 6 = Sat
  return js === 0 ? 7 : js;
}

/**
 * Day-of-month for `dow` in the week the device is currently in — the serif
 * numeral on each `.day` cell.
 *
 * The numeral is what makes the strip read as torn off a calendar rather than
 * as a row of filter chips, which is why the pitch sets it in the book face and
 * not in the UI sans. It is derived here rather than passed in because it is
 * pure decoration of the weekday the caller already chose: no screen decides
 * anything from it, and threading a date through every call site would make the
 * prop contract wider for a number that is always "whatever week it is now".
 */
function dateOfWeekday(dow: number): number {
  const now = new Date();
  const shifted = new Date(now);
  shifted.setDate(now.getDate() + (dow - todayDayOfWeekLocal()));
  return shifted.getDate();
}

export interface DaySelectorProps {
  /** Day columns actually in this timetable, ascending — from `GridShape.days`. */
  days: number[];
  /** The day currently shown below the strip. */
  selectedDay: number | null;
  /** 1-7, or null when today is not a school day in this grid (e.g. Sunday). */
  todayDayOfWeek: number | null;
  onSelect: (day: number) => void;
}

/**
 * `.dstrip` — the day axis as a horizontally scrolling strip of 44dp `.day`
 * cells: an uppercase weekday over a serif date numeral.
 *
 * A phone at 360px cannot show the web's 6-column week table and stay legible,
 * so the day axis lives here and the period axis becomes a vertical list
 * (`TimetableList`) for whichever single day is selected. Days a school never
 * runs never get a cell, mirroring `WeekGrid` dropping empty day columns.
 *
 * `.sel` fills indigo; `.today` (when it is not the selected cell) is outlined
 * in amber. Two independent signals on the same cell, deliberately: a teacher
 * can read Friday's page on a Monday, and it must stay obvious which day it
 * actually is while they do — which is also why the amber bead is its own node
 * with its own testID, so that signal survives the cell being selected, filled
 * indigo, and losing its amber outline.
 *
 * Shared by the teacher's timetable and the student's, so both portals get one
 * date strip rather than two that drift.
 */
export function DaySelector({ days, selectedDay, todayDayOfWeek, onSelect }: DaySelectorProps) {
  const tokens = useTokens();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 2, paddingVertical: 4 }}
    >
      {days.map((day) => {
        const isSelected = day === selectedDay;
        const isToday = day === todayDayOfWeek;
        return (
          <Pressable
            key={day}
            testID={`day-chip-${day}`}
            accessibilityRole="button"
            accessibilityLabel={`${DAY_LABELS[day] ?? `Day ${day}`}${isToday ? ', today' : ''}`}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(day)}
            style={{
              width: 44,
              alignItems: 'center',
              borderWidth: 1,
              borderRadius: 11,
              paddingTop: 6,
              paddingBottom: 7,
              backgroundColor: isSelected
                ? tokens.color.indigo
                : isToday
                  ? tokens.color.amber50
                  : tokens.color.surface,
              borderColor: isSelected
                ? tokens.color.indigo
                : isToday
                  ? tokens.color.amber
                  : tokens.color.line,
            }}
          >
            <Text
              style={{
                fontSize: 8.5,
                fontWeight: '800',
                letterSpacing: 0.5,
                color: isSelected ? tokens.color.onBrand : isToday ? tokens.color.late : tokens.color.sub,
              }}
            >
              {DAY_LABELS[day] ?? `D${day}`}
            </Text>
            <Text
              style={{
                fontFamily: font.serif,
                fontSize: 15,
                marginTop: 1,
                color: isSelected ? tokens.color.onBrand : isToday ? tokens.color.late : tokens.color.ink,
              }}
            >
              {dateOfWeekday(day)}
            </Text>
            {isToday && (
              <View
                testID={`day-chip-today-label-${day}`}
                accessibilityLabel="Today"
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  marginTop: 3,
                  backgroundColor: isSelected ? tokens.color.onBrand : tokens.color.amber,
                }}
              />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
