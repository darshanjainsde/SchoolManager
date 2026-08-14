import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, Text, View } from 'react-native';
import { currentMonthKey, monthKeyLabel, shiftMonthKey } from '@/lib/attendance-grid';
import { todayISO } from '@/lib/attendance';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

export interface CalendarSheetProps {
  open: boolean;
  /** What the picker is choosing — "From" / "To". Shown as the sheet title. */
  title: string;
  /** YYYY-MM-DD — the currently chosen date; its month opens first. */
  value: string;
  /** YYYY-MM-DD — days before this are unpickable (e.g. a To picker floored
      at the chosen From). Omit for no floor. */
  minDate?: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function daysInMonth(key: string): number {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1;
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Blanks before day 1 in a Monday-first week. */
function leadingBlanks(key: string): number {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1;
  return (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
}

function dayKey(monthKey: string, day: number): string {
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/**
 * A bottom-sheet month calendar for picking a single date — replaces the
 * one-day-at-a-time ‹ › steppers on the leave form, where walking to a date
 * three weeks out took twenty-one taps and gave no sense of which weekday
 * anything fell on.
 *
 * Deliberately dependency-free: a month is just arithmetic, and the app
 * already owns the month-key helpers (attendance uses the same ones).
 * Reduce-motion turns the slide into a fade, the standing rule.
 */
export function CalendarSheet({ open, title, value, minDate, onPick, onClose }: CalendarSheetProps) {
  const tokens = useTokens();
  const [reduced, setReduced] = useState(false);
  // The month being looked at — reset to the chosen date's month each open.
  const [month, setMonth] = useState(() => value.slice(0, 7));
  useEffect(() => {
    if (open) setMonth(value.slice(0, 7));
  }, [open, value]);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!cancelled) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(v));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const today = todayISO();
  // No point paging into months that end before the floor.
  const atFloorMonth = !!minDate && month <= minDate.slice(0, 7);

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks(month) }, () => null),
    ...Array.from({ length: daysInMonth(month) }, (_, i) => i + 1),
  ];

  return (
    <Modal visible={open} transparent animationType={reduced ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          testID="calendar-backdrop"
          accessibilityRole="button"
          accessibilityLabel="Close the calendar"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: `${tokens.color.ink}73` }}
        />
        <View
          testID="calendar-sheet"
          style={{
            backgroundColor: tokens.color.appBg,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 22,
            shadowColor: tokens.color.ink,
            shadowOpacity: 0.3,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: -8 },
            elevation: 16,
          }}
        >
          <View
            style={{
              width: 34,
              height: 4,
              borderRadius: 99,
              backgroundColor: tokens.color.line,
              alignSelf: 'center',
              marginBottom: 9,
            }}
          />
          <Text
            style={{
              fontFamily: font.serif,
              fontSize: 17,
              fontWeight: '600',
              letterSpacing: -0.2,
              color: tokens.color.ink,
              marginBottom: 8,
            }}
          >
            {title}
          </Text>

          {/* Month header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Pressable
              testID="calendar-prev-month"
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              accessibilityState={{ disabled: atFloorMonth }}
              disabled={atFloorMonth}
              onPress={() => setMonth((m) => shiftMonthKey(m, -1))}
              hitSlop={8}
              style={{ opacity: atFloorMonth ? 0.35 : 1, paddingVertical: 4, paddingHorizontal: 10 }}
            >
              <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 15 }}>‹</Text>
            </Pressable>
            <Text testID="calendar-month-label" style={{ fontFamily: font.serif, fontSize: 15, color: tokens.color.ink }}>
              {monthKeyLabel(month)}
            </Text>
            <Pressable
              testID="calendar-next-month"
              accessibilityRole="button"
              accessibilityLabel="Next month"
              onPress={() => setMonth((m) => shiftMonthKey(m, 1))}
              hitSlop={8}
              style={{ paddingVertical: 4, paddingHorizontal: 10 }}
            >
              <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 15 }}>›</Text>
            </Pressable>
          </View>

          {/* Weekday rail */}
          <View style={{ flexDirection: 'row' }}>
            {WEEKDAYS.map((w, i) => (
              <Text
                key={`${w}-${i}`}
                style={{
                  flexBasis: `${100 / 7}%`,
                  textAlign: 'center',
                  fontSize: 10.5,
                  fontWeight: '700',
                  color: tokens.color.sub,
                  paddingVertical: 4,
                }}
              >
                {w}
              </Text>
            ))}
          </View>

          {/* Day grid */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cells.map((day, i) => {
              if (day === null) {
                return <View key={`blank-${i}`} style={{ flexBasis: `${100 / 7}%`, height: 40 }} />;
              }
              const iso = dayKey(month, day);
              const chosen = iso === value;
              const isToday = iso === today;
              const belowFloor = !!minDate && iso < minDate;
              return (
                <Pressable
                  key={iso}
                  testID={`calendar-day-${iso}`}
                  accessibilityRole="button"
                  accessibilityLabel={iso}
                  accessibilityState={{ disabled: belowFloor, selected: chosen }}
                  disabled={belowFloor}
                  onPress={() => {
                    onPick(iso);
                    onClose();
                  }}
                  style={{ flexBasis: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: chosen ? tokens.color.indigo : 'transparent',
                      borderWidth: isToday && !chosen ? 1 : 0,
                      borderColor: tokens.color.indigo,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13.5,
                        fontWeight: chosen || isToday ? '700' : '500',
                        color: chosen
                          ? tokens.color.onBrand
                          : belowFloor
                            ? tokens.color.line
                            : tokens.color.ink,
                      }}
                    >
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}
