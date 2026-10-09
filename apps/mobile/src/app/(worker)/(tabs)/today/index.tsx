import { useReload } from '@/lib/query';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { useSession } from '@/lib/use-session';
import { jobFor } from '@/lib/worker-nav';
import { todayISO } from '@/lib/attendance';
import { fmtDate, fmtLongDay, fmtMonthYear, fmtWeekdayDay } from '@/lib/dates';
import { AccountsToday } from '@/components/AccountsToday';
import { Button } from '@/components/Button';
import { Icon } from '@/components/icons';
import { Card, Empty, ErrorState, Pill, Screen } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { NotificationBell } from '@/components/NotificationBell';
import { useTokens } from '@/theme/theme-context';

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE';

interface PersonDay {
  /** `YYYY-MM-DD` */
  date: string;
  status: Status;
}

interface PersonSummary {
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  percent: number;
  days: PersonDay[];
}

interface MyStaffAttendance {
  person: { id: string; firstName: string; lastName: string; role: string };
  summary: PersonSummary;
}

interface Holiday { id: string; name: string; startDate: string; endDate: string | null }

const STATUS_LABEL: Record<Status, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  ON_LEAVE: 'On leave',
};

const STATUS_TONE: Record<Status, 'green' | 'red' | 'amber' | 'indigo'> = {
  PRESENT: 'green',
  ABSENT: 'red',
  LATE: 'amber',
  ON_LEAVE: 'indigo',
};

const STAFF_ROLE_LABEL: Record<string, string> = {
  OFFICE: 'Office staff',
  SUPPORT: 'Support staff',
  DRIVER: 'Driver',
  HELPER: 'Helper',
  SECURITY: 'Security',
  LIBRARIAN: 'Librarian',
  SPORTS: 'Sports teacher',
  ACCOUNTS: 'Accounts officer',
  ADMISSIONS: 'Admissions officer',
  OTHER: 'Staff',
};

/** A figure box: the number large and tabular, the label a sentence under it. */
function Figure({ testID, value, label, color }: { testID: string; value: string; label: string; color: string }) {
  const tokens = useTokens();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.surface, borderColor: tokens.color.line, borderWidth: 1, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12 }}>
      <Text testID={testID} style={{ fontSize: 22, lineHeight: 28, fontWeight: '700', color, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ fontSize: 12, lineHeight: 16, color: tokens.color.sub }}>{label}</Text>
    </View>
  );
}

/**
 * THE MONTH, AS A STRIP OF DAYS. The same data the "Recent" list held, but
 * it fills the screen with meaning: a square per day, present in green,
 * absent in red, leave in indigo, a Sunday quiet, today ringed. The emptiest
 * screen in the app (71% blank) was this one with three figures and a
 * four-row list (re-audit 2026-10-08).
 */
function MonthStrip({ days, today }: { days: PersonDay[]; today: string }) {
  const tokens = useTokens();
  const c = tokens.color;
  const ym = today.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const count = new Date(y, m, 0).getDate();
  const byDate = new Map(days.map((d) => [d.date.slice(0, 10), d.status] as const));
  const cells: { key: string; n: string; bg: string; ink: string; ring: boolean }[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ key: `b${i}`, n: '', bg: 'transparent', ink: c.sub, ring: false });
  for (let n = 1; n <= count; n += 1) {
    const iso = `${ym}-${String(n).padStart(2, '0')}`;
    const dow = (lead + n - 1) % 7;
    const status = byDate.get(iso);
    const tone = status === 'PRESENT' ? { bg: c.green50, ink: c.green } : status === 'ABSENT' ? { bg: c.red50, ink: c.red } : status === 'LATE' ? { bg: c.amber50, ink: c.late } : status === 'ON_LEAVE' ? { bg: c.indigo50, ink: c.indigo } : dow === 6 ? { bg: c.surfaceMuted, ink: c.placeholder } : { bg: c.surface, ink: c.ink2 };
    cells.push({ key: iso, n: String(n), bg: tone.bg, ink: tone.ink, ring: iso === today });
  }
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={`${d}${i}`} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: '700', color: c.sub }}>{d}</Text>
        ))}
      </View>
      {Array.from({ length: Math.ceil(cells.length / 7) }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 4 }}>
          {cells.slice(r * 7, r * 7 + 7).map((cell) => (
            <View key={cell.key} style={{ flex: 1, height: 34, borderRadius: 9, backgroundColor: cell.bg, alignItems: 'center', justifyContent: 'center', borderWidth: cell.ring ? 2 : cell.n ? 1 : 0, borderColor: cell.ring ? c.indigo : c.line }}>
              <Text style={{ fontSize: 12, fontWeight: cell.ring ? '700' : '500', color: cell.ink }}>{cell.n}</Text>
            </View>
          ))}
          {cells.slice(r * 7, r * 7 + 7).length < 7
            ? Array.from({ length: 7 - cells.slice(r * 7, r * 7 + 7).length }, (_, i) => <View key={`t${i}`} style={{ flex: 1 }} />)
            : null}
        </View>
      ))}
    </View>
  );
}

export default function Today() {
  const session = useSession();
  const job = jobFor(session);
  if (job === 'ACCOUNTS') return <AccountsToday firstName={session?.displayName?.split(' ')[0] ?? 'there'} />;
  return <StaffToday />;
}

/**
 * OFFICE, DRIVERS, SECURITY, SUPPORT: a Today that fills the phone without
 * any record existing — today's standing, the month as a strip, the two
 * things they come for (leave, payslip), and the next holiday.
 */
function StaffToday() {
  const tokens = useTokens();
  const c = tokens.color;
  const [reloadKey, reload] = useReload();
  const [data, setData] = useState<MyStaffAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holidays = useQuery<Holiday[]>('/me/holidays');
  const today = todayISO();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<MyStaffAttendance>('/manage/staff-attendance/mine')
        .then((res) => {
          if (!cancelled) setData(res);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, [reloadKey]),
  );

  const summary = data?.summary;
  const marked = summary ? summary.present + summary.absent + summary.late + summary.onLeave : 0;
  const todayStatus = summary?.days.find((d) => d.date.slice(0, 10) === today)?.status;
  const nextHoliday = (holidays.data ?? [])
    .filter((h) => h.startDate.slice(0, 10) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const [y, m] = today.split('-').map(Number);

  return (
    <Screen onRefresh={reload}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: c.sub, fontWeight: '500' }}>
            {fmtLongDay(new Date())}{data ? ` · ${STAFF_ROLE_LABEL[data.person.role] ?? 'Staff'}` : ''}
          </Text>
          <Text style={{ fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.4, color: c.ink }}>
            {data ? `Hi, ${data.person.firstName}` : 'Today'}
          </Text>
        </View>
        <NotificationBell group="(worker)" />
      </View>

      {error && <ErrorState error={error} onRetry={reload} />}
      {data === null && !error && <LoadingRows label="Loading your attendance…" rows={3} />}

      {summary && !error && (
        <>
          {/* Today's standing: the hero. */}
          <View style={{ backgroundColor: todayStatus === 'PRESENT' ? c.green50 : todayStatus === 'ABSENT' ? c.red50 : c.indigo50, borderRadius: tokens.radius.card, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={todayStatus === 'PRESENT' ? 'check' : 'take'} size={28} color={todayStatus === 'PRESENT' ? c.green : todayStatus === 'ABSENT' ? c.red : c.indigo} fillOpacity={0.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: c.sub }}>TODAY</Text>
              <Text testID="today-standing" style={{ fontSize: 19, lineHeight: 26, fontWeight: '700', color: c.ink }}>
                {todayStatus ? `Marked ${STATUS_LABEL[todayStatus].toLowerCase()}` : 'Not marked yet'}
              </Text>
              <Text style={{ fontSize: 12.5, color: c.sub }}>{todayStatus ? 'By the office' : 'The office marks staff attendance during the day'}</Text>
            </View>
          </View>

          {marked === 0 ? (
            <Card style={{ padding: 0 }}>
              <Empty kind="done" title={`${fmtMonthYear(y, m - 1)} starts clean`}>
                No attendance has been recorded for you yet this month.
              </Empty>
            </Card>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Figure testID="stat-percent" value={`${summary.percent}%`} label="this month" color={c.green} />
                <Figure testID="stat-present" value={String(summary.present)} label="days present" color={c.ink} />
                <Figure testID="stat-absent" value={String(summary.absent)} label="absent" color={summary.absent ? c.red : c.ink} />
              </View>
              <Card style={{ gap: 10 }} testID="recent-days">
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: c.sub }}>{fmtMonthYear(y, m - 1).toUpperCase()}</Text>
                  <Text style={{ fontSize: 12, color: c.sub }}>{marked} {marked === 1 ? 'day' : 'days'} marked</Text>
                </View>
                <MonthStrip days={summary.days} today={today} />
                <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                  {(['PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE'] as Status[]).map((s) => (
                    <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Pill tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Pill>
                    </View>
                  ))}
                </View>
                {/* The most recent day, in words, so a glance still reads a date. */}
                {summary.days.length > 0 ? (
                  <Text style={{ fontSize: 12.5, color: c.sub }}>
                    Last marked {fmtDate(summary.days[summary.days.length - 1].date)} · {STATUS_LABEL[summary.days[summary.days.length - 1].status]}
                  </Text>
                ) : null}
              </Card>
            </>
          )}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Card style={{ flex: 1, gap: 6, padding: 14 }} testID="today-leave-tile">
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.indigo50, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="lock" size={20} color={c.indigo} fillOpacity={0.15} />
              </View>
              <Text style={{ fontSize: 14, fontWeight: '700', color: c.ink }}>Leave</Text>
              <Text style={{ fontSize: 12, lineHeight: 17, color: c.sub }}>Apply through the office for now. On the app soon.</Text>
            </Card>
            <Card style={{ flex: 1, gap: 6, padding: 14 }} testID="today-pay-tile">
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.indigo50, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="fees" size={20} color={c.indigo} fillOpacity={0.15} />
              </View>
              <Text style={{ fontSize: 14, fontWeight: '700', color: c.ink }}>My pay</Text>
              <Text style={{ fontSize: 12, lineHeight: 17, color: c.sub }}>Payslips, as they are issued</Text>
              <Button label="Open" variant="text" size="sm" onPress={() => router.push('/(worker)/(tabs)/profile/salary')} style={{ marginLeft: -12 }} />
            </Card>
          </View>

          {nextHoliday ? (
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }} testID="today-holiday">
              <View style={{ width: 40, height: 42, borderRadius: 12, backgroundColor: c.indigo50, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 9.5, fontWeight: '700', color: c.indigo }}>{['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][new Date(nextHoliday.startDate.slice(0, 10)).getMonth()]}</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: c.indigo, lineHeight: 18 }}>{new Date(nextHoliday.startDate.slice(0, 10)).getDate()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: c.ink }}>{nextHoliday.name} · next holiday</Text>
                <Text style={{ fontSize: 12.5, color: c.sub }}>{fmtWeekdayDay(nextHoliday.startDate.slice(0, 10))} · school closed</Text>
              </View>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
