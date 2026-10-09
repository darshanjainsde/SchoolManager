import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { shiftISO, todayISO } from '@/lib/attendance';
import { fmtDay, fmtLongDay, fmtWeekdayDay } from '@/lib/dates';
import { leaveTypeLabel } from '@/lib/labels';
import { Button } from './Button';
import { Icon } from './icons';
import { RoleHero } from './HeroDeck';
import { NotificationBell } from './NotificationBell';
import { LoadingRows } from './Loading';
import { Card, Empty, Screen } from './ui';
import { useTokens } from '@/theme/theme-context';

/**
 * THE ACCOUNTS OFFICER'S TODAY (UI v2, researched 2026-10-08).
 *
 * The home every narrow-role app converges on (Workday, Teams frontline,
 * greytHR): greeting → the one thing to do → what awaits me, capped at
 * three rows → the next things in time → notices. Before this the desk
 * opened on three bare tabs and, often, a locked Pay page.
 */
interface LeaveRow { id: string; teacherName: string; type: string; startDate: string; endDate: string; halfDay: boolean; reason: string | null }
interface GapRow { id: string; date: string; classSectionName: string; substituteTeacherId: string | null }
interface Holiday { id: string; name: string; startDate: string; endDate: string | null }

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[p.length - 1]?.[0] ?? '')).toUpperCase();
}

export function AccountsToday({ firstName }: { firstName: string }) {
  const tokens = useTokens();
  const c = tokens.color;
  const today = todayISO();
  const tomorrow = shiftISO(today, 1);
  const pending = useQuery<LeaveRow[]>('/manage/leave?status=PENDING');
  const coverage = useQuery<GapRow[]>(`/manage/leave/coverage?from=${tomorrow}&to=${shiftISO(today, 7)}`);
  const holidays = useQuery<Holiday[]>('/me/holidays');
  const pay = useQuery<{ month: string }>('/payroll/overview');

  const waiting = pending.data ?? [];
  const gaps = (coverage.data ?? []).filter((g) => !g.substituteTeacherId);
  const gapsTomorrow = gaps.filter((g) => g.date.slice(0, 10) === tomorrow);
  const nextHolidays = (holidays.data ?? [])
    .filter((h) => h.startDate.slice(0, 10) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 2);
  const payLocked = pay.error instanceof ApiError && (pay.error.status === 403 || pay.error.status === 404);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Screen onRefresh={() => { pending.refresh(); coverage.refresh(); holidays.refresh(); }} refreshing={pending.refreshing}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: c.sub, fontWeight: '500' }}>{fmtLongDay(new Date())} · Accounts</Text>
          <Text testID="accounts-greeting" style={{ fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.4, color: c.ink }}>{greeting}, {firstName}</Text>
        </View>
        <NotificationBell group="(worker)" />
      </View>

      {/* THE HERO (9 Oct 2026): the desk's day in one card — what waits,
          what needs cover, and the four things this desk does from Home. */}
      <RoleHero
        testID="accounts-hero"
        quiet={waiting.length === 0}
        eyebrow="Leave desk"
        title={waiting.length === 0 ? 'Nothing waiting on you' : waiting.length === 1 ? '1 request waiting' : `${waiting.length} requests waiting`}
        line={gapsTomorrow.length ? `${gapsTomorrow.length} ${gapsTomorrow.length === 1 ? 'class' : 'classes'} tomorrow need a teacher` : 'Every class is covered tomorrow'}
        figures={[
          { value: String(waiting.length), label: 'waiting', onPress: () => router.push('/(worker)/(tabs)/leavedesk') },
          { value: String(gaps.length), label: 'need cover', onPress: () => router.push('/(worker)/(tabs)/leavedesk') },
          { value: payLocked ? 'Locked' : 'Open', label: 'pay', onPress: () => router.push('/(worker)/(tabs)/paydesk') },
        ]}
        actions={[
          { label: 'Decide', icon: 'requests', badge: waiting.length, testID: 'hero-act-decide', onPress: () => router.push('/(worker)/(tabs)/leavedesk') },
          { label: 'Cover', icon: 'timetable', testID: 'hero-act-cover', onPress: () => router.push('/(worker)/(tabs)/leavedesk') },
          { label: 'Pay', icon: 'fees', testID: 'hero-act-pay', onPress: () => router.push('/(worker)/(tabs)/paydesk') },
          { label: 'My pay', icon: 'report', testID: 'hero-act-mypay', onPress: () => router.push('/(worker)/(tabs)/profile/salary') },
        ]}
      />

      {/* Awaiting you */}
      <Card style={{ padding: 0, gap: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: waiting.length ? c.red : c.green }} />
            <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: c.sub }}>AWAITING YOU · {waiting.length}</Text>
          </View>
          {waiting.length > 3 ? <Button label="See all" variant="text" size="sm" onPress={() => router.push('/(worker)/(tabs)/leavedesk')} /> : null}
        </View>
        {!pending.data && !pending.error ? (
          <LoadingRows label="leave waiting" rows={3} />
        ) : waiting.length === 0 ? (
          <Empty kind="done" title="No leave requests waiting">
            New requests land here and ring the bell. Anything undecided is left out of the month's pay.
          </Empty>
        ) : (
          <>
            {waiting.slice(0, 3).map((r, i) => (
              <View key={r.id} testID={`today-waiting-${r.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.line }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.indigo50, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: c.indigo, fontWeight: '700', fontSize: 12.5 }}>{initials(r.teacherName)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: c.ink }}>{r.teacherName}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, color: c.sub }}>
                    {leaveTypeLabel(r.type)} · {fmtDay(r.startDate.slice(0, 10))}{r.startDate.slice(0, 10) !== r.endDate.slice(0, 10) ? ` – ${fmtDay(r.endDate.slice(0, 10))}` : ''}{r.reason ? ` · ${r.reason}` : ''}
                  </Text>
                </View>
              </View>
            ))}
            <View style={{ padding: 12, paddingTop: 6 }}>
              <Button
                label={waiting.length === 1 ? 'Decide the request' : `Decide the ${waiting.length} requests`}
                icon="check"
                block
                onPress={() => router.push('/(worker)/(tabs)/leavedesk')}
                testID="today-decide"
              />
            </View>
          </>
        )}
      </Card>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Card style={{ flex: 1, gap: 4, padding: 14 }} testID="today-pay-card">
          <Text style={{ fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6, color: c.sub }}>PAY</Text>
          {payLocked ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="lock" size={16} color={c.red} fillOpacity={0.15} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: c.red }}>Locked</Text>
              </View>
              <Text style={{ fontSize: 12, lineHeight: 17, color: c.sub }}>The admin grants it under Settings → Pay</Text>
              <Button label="See what's in Pay" variant="text" size="sm" onPress={() => router.push('/(worker)/(tabs)/paydesk')} style={{ marginLeft: -12 }} />
            </>
          ) : (
            <>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.ink }}>{pay.data?.month ?? 'This month'}</Text>
              <Text style={{ fontSize: 12, lineHeight: 17, color: c.sub }}>What the month costs, by grade</Text>
              <Button label="Open Pay" variant="text" size="sm" onPress={() => router.push('/(worker)/(tabs)/paydesk')} style={{ marginLeft: -12 }} />
            </>
          )}
        </Card>
        <Card style={{ flex: 1, gap: 4, padding: 14 }} testID="today-cover-card">
          <Text style={{ fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6, color: c.sub }}>COVER · TOMORROW</Text>
          <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: '700', color: gapsTomorrow.length ? c.late : c.ink, fontVariant: ['tabular-nums'] }}>
            {gapsTomorrow.length}
            <Text style={{ fontSize: 13, color: c.sub, fontWeight: '600' }}> {gapsTomorrow.length === 1 ? 'class' : 'classes'}</Text>
          </Text>
          <Text style={{ fontSize: 12, lineHeight: 17, color: gapsTomorrow.length ? c.late : c.sub, fontWeight: gapsTomorrow.length ? '600' : '400' }}>
            {gapsTomorrow.length ? 'with no teacher yet' : gaps.length ? `${gaps.length} this week need a teacher` : 'everything is covered this week'}
          </Text>
          <Button label={gaps.length ? 'Find cover' : 'Coverage'} variant="text" size="sm" onPress={() => router.push('/(worker)/(tabs)/leavedesk')} style={{ marginLeft: -12 }} />
        </Card>
      </View>

      <Card style={{ padding: 0 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: c.sub, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>UPCOMING</Text>
        {nextHolidays.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.sub, paddingHorizontal: 16, paddingBottom: 14 }}>No holidays on the calendar yet.</Text>
        ) : (
          nextHolidays.map((h, i) => {
            const d = new Date(h.startDate.slice(0, 10));
            return (
              <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.line }}>
                <View style={{ width: 40, height: 42, borderRadius: 12, backgroundColor: c.indigo50, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 9.5, fontWeight: '700', color: c.indigo }}>{['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()]}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.indigo, lineHeight: 18 }}>{d.getDate()}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: c.ink }}>{h.name}</Text>
                  <Text style={{ fontSize: 12.5, color: c.sub }}>{fmtWeekdayDay(h.startDate.slice(0, 10))}{h.endDate && h.endDate.slice(0, 10) !== h.startDate.slice(0, 10) ? ` – ${fmtWeekdayDay(h.endDate.slice(0, 10))}` : ''} · school closed</Text>
                </View>
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}
