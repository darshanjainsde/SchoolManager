import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { AttendanceSummary } from '@/lib/portal';
import { buildAttendanceGrid, currentMonthKey, monthKeyLabel, shiftMonthKey } from '@/lib/attendance-grid';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import type { ColorPalette } from '@/theme/tokens';

// Monday-first, matching the web portal's `apps/web/app/portal/attendance/
// page.tsx` ordering (and the timetable's day axis, both here and on the
// web) — the app's calendar used to be Sunday-first; this is the parity fix.
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CELL_WIDTH = `${100 / 7}%` as const;

function cellColors(tokens: { color: ColorPalette }, status: 'PRESENT' | 'ABSENT' | 'LATE' | null) {
  if (status === 'PRESENT' || status === 'LATE') return { bg: tokens.color.green50, fg: tokens.color.green };
  if (status === 'ABSENT') return { bg: tokens.color.red50, fg: tokens.color.red };
  return { bg: tokens.color.surfaceMuted, fg: tokens.color.sub };
}

function StatBox({
  testID,
  value,
  label,
  color,
}: {
  testID: string;
  value: string;
  label: string;
  color: string;
}) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.line,
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        alignItems: 'center',
      }}
    >
      <Text testID={testID} style={{ fontSize: 20, fontWeight: '800', color }}>
        {value}
      </Text>
      <Text style={{ fontSize: 10.5, color: tokens.color.sub, marginTop: 1 }}>{label}</Text>
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
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 }}>
      <Pressable
        testID="attendance-prev-month"
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        onPress={onPrev}
        style={{
          borderWidth: 1,
          borderColor: tokens.color.line,
          borderRadius: 10,
          paddingVertical: 6,
          paddingHorizontal: 12,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>‹ Prev</Text>
      </Pressable>
      <Text testID="attendance-month-label" style={{ fontSize: 14, fontWeight: '800', color: tokens.color.ink }}>
        {monthKeyLabel(month)}
      </Text>
      <Pressable
        testID="attendance-next-month"
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: atLatestMonth }}
        disabled={atLatestMonth}
        onPress={onNext}
        style={{
          borderWidth: 1,
          borderColor: tokens.color.line,
          borderRadius: 10,
          paddingVertical: 6,
          paddingHorizontal: 12,
          opacity: atLatestMonth ? 0.4 : 1,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>Next ›</Text>
      </Pressable>
    </View>
  );
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

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatBox testID="stat-percent" value={`${summary.percent}%`} label="Present" color={tokens.color.green} />
            <StatBox testID="stat-absent" value={String(summary.absent)} label="Absences" color={tokens.color.red} />
            <StatBox testID="stat-total" value={String(total)} label="School days" color={tokens.color.ink} />
          </View>
          {total === 0 ? (
            <Card>
              <Text style={{ color: tokens.color.sub }}>No attendance recorded yet this month.</Text>
            </Card>
          ) : (
            <>
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
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
                    const { bg, fg } = cellColors(tokens, cell.status);
                    return (
                      <View
                        key={`cell-${i}`}
                        testID={`attn-cell-${i}`}
                        style={{ width: CELL_WIDTH, aspectRatio: 1, padding: 2 }}
                      >
                        {cell.day !== null && (
                          <View
                            style={{
                              flex: 1,
                              borderRadius: 9,
                              backgroundColor: bg,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text testID={`attn-day-${cell.day}`} style={{ fontSize: 12, fontWeight: '600', color: fg }}>
                              {cell.day}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </Card>
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
                    <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>{d.date}</Text>
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
