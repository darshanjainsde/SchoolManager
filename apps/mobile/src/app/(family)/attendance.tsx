import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { AttendanceSummary } from '@/lib/portal';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import type { ColorPalette } from '@/theme/tokens';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CELL_WIDTH = `${100 / 7}%` as const;

interface Cell {
  day: number | null;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | null;
}

/**
 * Builds a 7-wide (Sun-first) month grid from `summary.days`. Day-of-week
 * for the 1st is computed with `Date.UTC` to match `AttendanceDay.date`,
 * which is a `YYYY-MM-DD` slice of a UTC-midnight `@db.Date` column — using
 * a local-time `Date` here could shift the leading offset by a day.
 */
function buildGrid(summary: AttendanceSummary): Cell[] {
  const year = Number(summary.month.slice(0, 4));
  const monthIndex = Number(summary.month.slice(5, 7)) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leading = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const byDay = new Map(summary.days.map((d) => [Number(d.date.slice(8, 10)), d.status]));

  const cells: Cell[] = [];
  for (let i = 0; i < leading; i++) cells.push({ day: null, status: null });
  for (let day = 1; day <= daysInMonth; day++) cells.push({ day, status: byDay.get(day) ?? null });
  return cells;
}

function cellColors(tokens: { color: ColorPalette }, status: Cell['status']) {
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

export default function Attendance() {
  const tokens = useTokens();
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      // No `month` query param — the server defaults to the current IST
      // month, which is the timezone that actually matters for school days.
      api
        .request<AttendanceSummary>('/me/attendance')
        .then((data) => {
          if (!cancelled) setSummary(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

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
      {summary && (
        <>
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
                  {buildGrid(summary).map((cell, i) => {
                    const { bg, fg } = cellColors(tokens, cell.status);
                    return (
                      <View key={`cell-${i}`} style={{ width: CELL_WIDTH, aspectRatio: 1, padding: 2 }}>
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
                            <Text style={{ fontSize: 12, fontWeight: '600', color: fg }}>{cell.day}</Text>
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
