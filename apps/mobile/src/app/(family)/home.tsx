import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { TimetableSlot } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import { minutesOfDay } from '@/lib/teacher-day';
import {
  daysUntilLabel,
  formatDate,
  relativeTime,
  type Announcement,
  type AttendanceSummary,
  type PublishedResult,
  type StudentProfile,
  type UpcomingExam,
} from '@/lib/portal';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { StudentHero } from '@/components/StudentHero';
import { useTokens } from '@/theme/theme-context';

/** How many of the most recent announcements the home screen surfaces (the full list lives on Notices). */
const LATEST_ANNOUNCEMENTS_COUNT = 3;

/** Minutes past midnight on the device's own clock. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** JS `getDay()` (0=Sun) → ISO weekday (1=Mon … 7=Sun) matching TimetableSlot.dayOfWeek. */
function isoWeekday(): number {
  return ((new Date().getDay() + 6) % 7) + 1;
}

function fullTeacherName(t: { firstName: string; lastName: string }): string {
  return `${t.firstName} ${t.lastName}`.trim();
}

/** A compact KPI tile — the mobile equivalent of the web portal's `sk-kpi` stat tiles. */
function KpiTile({
  label,
  value,
  hint,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
  onPress?: () => void;
}) {
  const tokens = useTokens();
  const toneColor: Record<'good' | 'warn' | 'bad', string> = {
    good: tokens.color.green,
    warn: tokens.color.late,
    bad: tokens.color.red,
  };
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.line,
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
      }}
    >
      <Text style={{ fontSize: 10.5, fontWeight: '600', color: tokens.color.sub }}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: '800', color: tone ? toneColor[tone] : tokens.color.ink, marginTop: 2 }}>
        {value}
      </Text>
      {hint && (
        <Text style={{ fontSize: 10, color: tokens.color.sub, marginTop: 1 }} numberOfLines={1}>
          {hint}
        </Text>
      )}
    </Pressable>
  );
}

function AnnouncementRow({ a }: { a: Announcement }) {
  const tokens = useTokens();
  return (
    <Card key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: tokens.color.indigo50,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 16 }}>📣</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>{a.title}</Text>
        <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
          {a.classSectionId ? 'Your class' : 'Whole school'} · {relativeTime(a.createdAt)}
        </Text>
      </View>
    </Card>
  );
}

/** One row of the "Today's classes" rail. */
function RailRow({
  slot,
  state,
  first,
}: {
  slot: TimetableSlot;
  state: 'past' | 'now' | 'upcoming';
  first: boolean;
}) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        padding: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
        backgroundColor: state === 'now' ? tokens.color.indigo50 : 'transparent',
        opacity: state === 'past' ? 0.55 : 1,
      }}
    >
      <Text style={{ fontSize: 10.5, fontWeight: '700', color: tokens.color.sub, width: 42, lineHeight: 14 }}>
        {slot.period.startTime}
        {'\n'}
        {slot.period.endTime}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }} numberOfLines={1}>
          {slot.subject.name}
        </Text>
        <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }} numberOfLines={1}>
          {fullTeacherName(slot.teacher)}
        </Text>
      </View>
      {state === 'now' ? (
        <Pill tone="indigo">Now</Pill>
      ) : state === 'past' ? (
        <Text style={{ fontSize: 11, color: tokens.color.sub }}>done</Text>
      ) : (
        <Pill tone="neutral">{slot.period.label}</Pill>
      )}
    </View>
  );
}

export default function Home() {
  const tokens = useTokens();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [exams, setExams] = useState<UpcomingExam[] | null>(null);
  const [results, setResults] = useState<PublishedResult[] | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus: a new notice, a fresh attendance mark, a newly scheduled
  // test/result, or simply time passing (a class ending) should all be
  // reflected the moment the family tab regains focus, not just on cold start.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      Promise.all([
        api.request<StudentProfile>('/me/profile'),
        api.request<Announcement[]>('/me/announcements'),
        api.request<AttendanceSummary>('/me/attendance'),
        api.request<UpcomingExam[]>('/me/exams'),
        api.request<PublishedResult[]>('/me/results'),
        api.request<TimetableSlot[]>('/me/timetable'),
      ])
        .then(([p, a, att, ex, res, tt]) => {
          if (cancelled) return;
          setProfile(p);
          setAnnouncements(a);
          setAttendance(att);
          setExams(ex);
          setResults(res);
          setSlots(tt);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const today = todayISO();
  const todayStatus = attendance?.days.find((d) => d.date === today)?.status ?? null;
  const attendanceMarked = attendance ? attendance.present + attendance.absent + attendance.late : 0;
  const nextExam = exams?.[0] ?? null;
  const latestResult = results?.[0] ?? null;
  const latestAnnouncements = (announcements ?? []).slice(0, LATEST_ANNOUNCEMENTS_COUNT);

  // Today's schedule, derived client-side from the weekly timetable (there is
  // no per-day endpoint — the whole week comes from /me/timetable).
  const now = nowMinutes();
  const isoDay = isoWeekday();
  const todaySlots = (slots ?? [])
    .filter((s) => s.dayOfWeek === isoDay)
    .sort((a, b) => a.period.order - b.period.order);
  const currentSlot =
    todaySlots.find(
      (s) => now >= minutesOfDay(s.period.startTime) && now < minutesOfDay(s.period.endTime),
    ) ?? null;
  const nextSlot = todaySlots.find((s) => minutesOfDay(s.period.startTime) > now) ?? null;
  const elapsed = currentSlot ? now - minutesOfDay(currentSlot.period.startTime) : 0;
  const total = currentSlot
    ? minutesOfDay(currentSlot.period.endTime) - minutesOfDay(currentSlot.period.startTime)
    : 0;

  function railState(s: TimetableSlot): 'past' | 'now' | 'upcoming' {
    if (currentSlot?.id === s.id) return 'now';
    return minutesOfDay(s.period.endTime) <= now ? 'past' : 'upcoming';
  }

  return (
    <Screen>
      <SectionTitle
        title={profile ? `Hi, ${profile.firstName} 👋` : 'Home'}
        right={<NotificationBell onPress={() => router.push('/(family)/notifications')} />}
      />

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {profile === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading…</Text>
        </Card>
      )}

      {profile && (
        <>
          {/* Class + roll are the student's OWN (not a parent-facing "your
              child" label) — one shared STUDENT login can't tell who's holding
              the phone, so this must read to either. */}
          <Text style={{ marginHorizontal: 4, marginTop: 2, fontSize: 12, color: tokens.color.sub }}>
            {profile.className ?? 'No class assigned'}
            {profile.rollNo ? ` · Roll ${profile.rollNo}` : ''}
          </Text>

          <StudentHero
            current={
              currentSlot
                ? {
                    subjectName: currentSlot.subject.name,
                    teacherName: fullTeacherName(currentSlot.teacher),
                    periodLabel: currentSlot.period.label,
                    startTime: currentSlot.period.startTime,
                    endTime: currentSlot.period.endTime,
                  }
                : null
            }
            elapsed={elapsed}
            total={total}
            next={
              nextSlot
                ? {
                    subjectName: nextSlot.subject.name,
                    teacherName: fullTeacherName(nextSlot.teacher),
                    startTime: nextSlot.period.startTime,
                  }
                : null
            }
            todayStatus={todayStatus}
            hasSchoolToday={todaySlots.length > 0}
            classesToday={todaySlots.length}
            monthPercent={attendanceMarked > 0 ? (attendance?.percent ?? null) : null}
          />

          {/* Next-test reminder — the thing a student should never miss. Tapping
              it opens the full detail (syllabus, max marks, date) on Results. */}
          {nextExam && (
            <Pressable testID="next-exam-banner" onPress={() => router.push('/(family)/results')}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: tokens.color.amber50,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 16 }}>🔔</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>
                    {nextExam.subjectName} · {nextExam.title} — {daysUntilLabel(nextExam.scheduledAt).toLowerCase()}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                    {formatDate(nextExam.scheduledAt)}
                    {nextExam.syllabus ? ` · ${nextExam.syllabus}` : ''} · out of {nextExam.maxMarks}
                  </Text>
                </View>
              </Card>
            </Pressable>
          )}

          {/* At-a-glance KPIs. Only two — "today" is already the hero's status
              chip and "next test" is the banner above, so repeating them would
              be noise. Both tiles deep-link to their full screen. */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <KpiTile
              label="This month"
              value={attendanceMarked > 0 ? `${attendance?.percent}%` : 'No records'}
              hint={attendanceMarked > 0 ? `${attendance?.present} of ${attendanceMarked} days present` : undefined}
              tone={attendance && attendanceMarked > 0 && attendance.percent < 75 ? 'warn' : undefined}
              onPress={() => router.push('/(family)/attendance')}
            />
            <KpiTile
              label="Latest result"
              value={latestResult ? `${latestResult.marks}/${latestResult.maxMarks}` : 'None yet'}
              hint={latestResult ? `${latestResult.subjectName} · class avg ${latestResult.classAverage}` : undefined}
              tone={latestResult ? (latestResult.marks < latestResult.classAverage ? 'bad' : 'good') : undefined}
              onPress={() => router.push('/(family)/results')}
            />
          </View>

          {todaySlots.length > 0 && (
            <>
              <SectionTitle
                title="Today's classes"
                actionLabel="Full week"
                onAction={() => router.push('/(family)/timetable')}
              />
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {todaySlots.map((s, i) => (
                  <RailRow key={s.id} slot={s} state={railState(s)} first={i === 0} />
                ))}
              </Card>
            </>
          )}

          <SectionTitle title="Latest announcements" />
          {latestAnnouncements.length === 0 ? (
            <Card>
              <Text style={{ color: tokens.color.sub }}>No announcements yet.</Text>
            </Card>
          ) : (
            latestAnnouncements.map((a) => <AnnouncementRow key={a.id} a={a} />)
          )}
        </>
      )}
    </Screen>
  );
}
