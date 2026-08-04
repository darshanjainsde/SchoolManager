import { useCallback, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { AttendanceSummary } from '@/lib/portal';
import { buildAttendanceGrid, currentMonthKey, monthKeyLabel, shiftMonthKey } from '@/lib/attendance-grid';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { DUR, inkWidth, useGesture } from '@/theme/motion';
import { useTokens } from '@/theme/theme-context';
import { font, type ColorPalette } from '@/theme/tokens';

// Monday-first, matching the web portal's `apps/web/app/portal/attendance/
// page.tsx` ordering (and the timetable's day axis, both here and on the
// web) — the app's calendar used to be Sunday-first; this is the parity fix.
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CELL_WIDTH = `${100 / 7}%` as const;

/**
 * The pitch's `.cell.P` / `.cell.A` / `.cell.L` tints, plus the untinted
 * `.cell.f` (a day in the month with nothing recorded against it — a Sunday,
 * a holiday, a day the register was never taken): it gets only a pencil rule
 * for a border, so the eye reads the month as "mostly quiet paper with a few
 * marks on it", which is exactly what a good attendance month IS.
 *
 * LATE keeps its own amber tint rather than folding into PRESENT (the old
 * behaviour): the register distinguishes them, so the calendar must too.
 */
function cellColors(tokens: { color: ColorPalette }, status: 'PRESENT' | 'ABSENT' | 'LATE' | null) {
  if (status === 'PRESENT') return { bg: tokens.color.green50, fg: tokens.color.green, border: 'transparent' };
  if (status === 'LATE') return { bg: tokens.color.amber50, fg: tokens.color.late, border: 'transparent' };
  if (status === 'ABSENT') return { bg: tokens.color.red50, fg: tokens.color.red, border: 'transparent' };
  return { bg: 'transparent', fg: tokens.color.sub, border: tokens.color.line };
}

/**
 * THE INK LINE — the pitch's `.attink`: the month's attendance draws itself
 * along a rule, left to right, the way a pen fills a progress line.
 *
 * WHY a motion at all: the percentage above it is the number, and the number
 * is already legible the instant it renders. The line exists to say how much
 * of the month that number COVERS — a fill that arrives instantly reads as a
 * static bar chart, while one that is drawn reads as a measurement being
 * taken. It is decorative by design: reduce-motion snaps it to its final
 * width and nothing is lost.
 *
 * `native: false` because this animates `width`, which is a layout prop and
 * cannot run on the UI thread. The caller remounts this (via `key={month}`)
 * when the month changes, so each month's line is drawn afresh instead of
 * silently jumping to a new length behind a spent animation.
 */
function InkRule({ percent }: { percent: number }) {
  const tokens = useTokens();
  const v = useGesture(true, DUR.ink, { native: false });
  return (
    <View
      style={{
        height: 7,
        borderRadius: tokens.radius.chip,
        backgroundColor: tokens.color.line,
        overflow: 'hidden',
        marginTop: 6,
        marginBottom: 12,
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          width: inkWidth(v, percent),
          borderRadius: tokens.radius.chip,
          backgroundColor: tokens.color.indigo,
        }}
      />
    </View>
  );
}

/**
 * A supporting figure under the rule: the number in mono (so a column of them
 * lines up), its word in the UI sans. Two nodes rather than one sentence, so
 * the figure itself stays independently addressable.
 */
function Figure({
  testID,
  value,
  label,
  color,
}: {
  testID: string;
  value: number;
  label: string;
  color?: string;
}) {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
      {/* Kept at a figure's own size and in its own ink. The repaint shrank
          these to 12px grey, which buried the ABSENCE COUNT — the one number
          on this screen a family actually goes looking for. */}
      <Text
        testID={testID}
        style={{ fontFamily: font.mono, fontSize: 17, fontWeight: '800', color: color ?? tokens.color.ink }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 11, color: tokens.color.sub }}>{label}</Text>
    </View>
  );
}

/** One `.legend` swatch: a 10px tinted square and the word it stands for. */
function LegendKey({ bg, border, label }: { bg: string; border?: string; label: string }) {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 4,
          backgroundColor: bg,
          borderWidth: border ? 1 : 0,
          borderColor: border ?? 'transparent',
        }}
      />
      <Text style={{ fontSize: 9.5, color: tokens.color.sub }}>{label}</Text>
    </View>
  );
}

/**
 * Month header with prev/next arrows — mirrors the web's month picker
 * (`apps/web/app/portal/attendance/page.tsx`). "Next" is disabled once the
 * shown month is the device's current local month; looking further ahead
 * can only ever show blanks (the server has no attendance data for the
 * future).
 */
function MonthNav({
  month,
  onPrev,
  onNext,
}: {
  month: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const tokens = useTokens();
  const atLatestMonth = month >= currentMonthKey();
  const arrow = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    backgroundColor: tokens.color.surface,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
  } as const;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 }}>
      <Pressable
        testID="attendance-prev-month"
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        onPress={onPrev}
        style={arrow}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink2 }}>‹ Prev</Text>
      </Pressable>
      <Text
        testID="attendance-month-label"
        style={{ fontFamily: font.serif, fontSize: 15, color: tokens.color.ink }}
      >
        {monthKeyLabel(month)}
      </Text>
      <Pressable
        testID="attendance-next-month"
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: atLatestMonth }}
        disabled={atLatestMonth}
        onPress={onNext}
        style={[arrow, { opacity: atLatestMonth ? 0.4 : 1 }]}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink2 }}>Next ›</Text>
      </Pressable>
    </View>
  );
}

/**
 * "August 2026" from "2026-08". Mirrors the web portal's `monthLabel`.
 *
 * The figures on this card used to be captioned "this month" no matter which
 * month Prev/Next had walked back to, so April's numbers were announced as
 * August's. A month view has to name its own month.
 */
function monthLabel(key: string): string {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1;
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export default function Attendance() {
  const tokens = useTokens();
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The month currently shown, once known — null until the first response
  // comes back and echoes it (see `load`). Kept in a ref too so the
  // focus-effect (which only ever runs its callback once, on mount/focus,
  // same convention as every other screen here) can read the LATEST picked
  // month without needing it in its dependency array.
  const [month, setMonth] = useState<string | null>(null);
  const monthRef = useRef<string | null>(null);
  // Guards against an in-flight request from a previous month landing after
  // a newer one, if the user taps Prev/Next faster than the network answers.
  const requestIdRef = useRef(0);

  const load = useCallback((m: string | null) => {
    const id = ++requestIdRef.current;
    setError(null);
    api
      .request<AttendanceSummary>(m ? `/me/attendance?month=${m}` : '/me/attendance')
      .then((data) => {
        if (requestIdRef.current !== id) return;
        setSummary(data);
        monthRef.current = data.month;
        setMonth(data.month);
      })
      .catch((e: unknown) => {
        if (requestIdRef.current !== id) return;
        setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      });
  }, []);

  // Refetch on focus, same convention as every other family screen — a
  // fresh attendance mark should show up without a manual pull-to-refresh.
  // No `month` query param on the very FIRST load (monthRef.current is
  // still null then) so the server defaults to the current IST month; once
  // a month is known (from the server's own echo, or a Prev/Next tap), that
  // exact month is what gets refetched on subsequent focuses.
  useFocusEffect(
    useCallback(() => {
      load(monthRef.current);
    }, [load]),
  );

  function prevMonth() {
    const current = monthRef.current;
    if (!current) return;
    load(shiftMonthKey(current, -1));
  }

  function nextMonth() {
    const current = monthRef.current;
    if (!current) return;
    load(shiftMonthKey(current, 1));
  }

  const total = summary ? summary.present + summary.absent + summary.late : 0;
  const recent = summary ? [...summary.days].reverse().slice(0, 5) : [];

  return (
    <Screen>
      <SectionTitle title="Attendance" />
      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {summary === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading attendance…</Text>
        </Card>
      )}
      {summary && month && (
        <>
          <MonthNav month={month} onPrev={prevMonth} onNext={nextMonth} />

          {/* The pitch's `.page .attwrap`: one sheet holding the figure, the
              rule it draws, and the month itself. */}
          <Card style={{ padding: 12 }}>
            {/* `.attkpi` — the figure set in mono so the digits line up
                month to month, next to a quiet sans label. */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text
                testID="stat-percent"
                style={{ fontFamily: font.mono, fontSize: 26, fontWeight: '700', color: tokens.color.indigo }}
              >
                {summary.percent}%
              </Text>
              <Text style={{ fontSize: 11, color: tokens.color.sub }}>
                present across {total} recorded {total === 1 ? 'day' : 'days'}
              </Text>
            </View>

            <InkRule key={month} percent={summary.percent} />

            {total === 0 ? (
              <Text style={{ color: tokens.color.sub, fontSize: 12.5 }}>
                No attendance recorded yet for {month ? monthLabel(month) : 'this month'}.
              </Text>
            ) : (
              <>
                {/* justifyContent:'center' distributes the 100/7% device-pixel
                    rounding remainder evenly — without it the leftover lands on
                    the right edge and the grid reads left-shifted (the S23
                    report, Phase 5·0b). */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {DOW.map((d, i) => (
                    <Text
                      key={`dow-${i}`}
                      style={{
                        width: CELL_WIDTH,
                        textAlign: 'center',
                        fontSize: 10,
                        fontWeight: '700',
                        color: tokens.color.sub,
                        marginBottom: 4,
                      }}
                    >
                      {d}
                    </Text>
                  ))}
                  {buildAttendanceGrid(summary).map((cell, i) => {
                    const { bg, fg, border } = cellColors(tokens, cell.status);
                    return (
                      <View
                        key={`cell-${i}`}
                        testID={`attn-cell-${i}`}
                        // NO `maxWidth` here. The weekday header above is laid
                        // out on the same `100/7%` column, with no cap — clamp
                        // only the cells and the two rows stop agreeing, so
                        // every letter sits off its own column.
                        style={{ width: CELL_WIDTH, aspectRatio: 1, padding: 2.5 }}
                      >
                        {cell.day !== null && (
                          <View
                            style={{
                              flex: 1,
                              borderRadius: 9,
                              backgroundColor: bg,
                              borderWidth: 1,
                              borderColor: border,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text
                              testID={`attn-day-${cell.day}`}
                              style={{
                                fontFamily: font.mono,
                                fontSize: 12,
                                fontWeight: cell.status && cell.status !== 'PRESENT' ? '800' : '600',
                                color: fg,
                              }}
                            >
                              {cell.day}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* `.legend` — the key to the tints, in the tints themselves. */}
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 12 }}>
                  <LegendKey bg={tokens.color.green50} label="present" />
                  <LegendKey bg={tokens.color.red50} label="absent" />
                  <LegendKey bg={tokens.color.amber50} label="late" />
                  <LegendKey bg="transparent" border={tokens.color.line} label="no register" />
                </View>
              </>
            )}

            {/* The two supporting figures, in mono under the rule — the
                percentage is the headline, these are its working. */}
            <View style={{ flexDirection: 'row', gap: 18, marginTop: 12 }}>
              {/* The same three states the web portal breaks out. "school
                  days" was wrong on both counts: it was the count of MARKED
                  days (an unmarked day isn't in it), and it left `late`
                  invisible — so a month with two late arrivals silently
                  didn't add up. */}
              <Figure testID="stat-present" value={summary.present} label="present" color={tokens.color.green} />
              <Figure testID="stat-absent" value={summary.absent} label="absent" color={tokens.color.red} />
              <Figure testID="stat-late" value={summary.late} label="late" color={tokens.color.late} />
            </View>
          </Card>

          {total > 0 && (
            <>
              <SectionTitle title="Recent" />
              <Card style={{ paddingVertical: 2 }}>
                {recent.map((d) => (
                  <View
                    key={d.date}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: 9,
                      borderBottomWidth: 1,
                      borderBottomColor: tokens.color.line,
                    }}
                  >
                    <Text style={{ fontFamily: font.mono, fontSize: 12, color: tokens.color.ink2 }}>{d.date}</Text>
                    <Pill tone={d.status === 'PRESENT' ? 'green' : d.status === 'LATE' ? 'amber' : 'red'}>
                      {d.status === 'PRESENT' ? 'Present' : d.status === 'LATE' ? 'Late' : 'Absent'}
                    </Pill>
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
