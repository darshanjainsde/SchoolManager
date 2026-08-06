import { useCallback, useState, type ReactNode } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { StudentDiaryResult, TimetableSlot } from '@skoolos/types';
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
import { Card, Page, PageHeader, Pill, RailRow, RailStatus, Screen, SectionTitle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { SettingsButton } from '@/components/SettingsButton';
import { StudentHero } from '@/components/StudentHero';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, pinStyle, useGesture } from '@/theme/motion';

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

/**
 * `.dateline` — the date written at the top of a diary page, in the serif
 * italic a person writes a date in, with the amber TODAY tab so a reader can
 * tell at a glance that this page is the current one and not one they have
 * scrolled back to.
 */
function Dateline() {
  const tokens = useTokens();
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginHorizontal: 2 }}>
      <Text
        style={{ fontFamily: font.serif, fontStyle: 'italic', fontSize: 12.5, color: tokens.color.sub }}
      >
        {today}
      </Text>
      <Text
        style={{
          fontSize: 9.5,
          fontWeight: '800',
          letterSpacing: 0.95,
          color: tokens.color.late,
          backgroundColor: tokens.color.amber50,
          borderRadius: 5,
          paddingHorizontal: 7,
          paddingVertical: 2,
          overflow: 'hidden',
        }}
      >
        TODAY
      </Text>
    </View>
  );
}

/**
 * A card that ARRIVED — a scheduled test, a circular from the office. It
 * lands with THE PIN (from above, slightly askew, settling straight), which
 * is the difference between "this is here" and "this just came in".
 *
 * The card itself is ordinary paper: ink title on the surface, behind its own
 * tinted icon tile. The repaint painted these as solid amber slips with amber
 * body text at 10px/75% opacity, which put the two things a family opens this
 * screen to read — the next test and the latest circular — at the lowest
 * contrast on the page. The tint belongs on the ICON, not on the words.
 */
function Notice({
  icon,
  tint,
  title,
  detail,
  onPress,
  testID,
}: {
  icon: string;
  tint: string;
  title: string;
  detail: string;
  onPress?: () => void;
  testID?: string;
}) {
  const tokens = useTokens();
  const pin = useGesture(true, DUR.pin, { native: true });
  return (
    <Animated.View style={pinStyle(pin)}>
      <Pressable testID={testID} onPress={onPress}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: tint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 16 }}>{icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{title}</Text>
            <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>{detail}</Text>
          </View>
        </Card>
      </Pressable>
    </Animated.View>
  );
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
      {/* `.attkpi .n` — figures are set in the mono face so a percentage and a
          mark out of fifty line up as numbers, not as words. */}
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 17,
          fontWeight: '700',
          color: tone ? toneColor[tone] : tokens.color.ink,
          marginTop: 2,
        }}
      >
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

/** The word in a period row's right-hand `.st` slot. */
function railStatusFor(state: 'past' | 'now' | 'upcoming', periodLabel: string): ReactNode {
  if (state === 'now') return <RailStatus tone="now">now</RailStatus>;
  if (state === 'past') return <RailStatus tone="good">✓</RailStatus>;
  return <RailStatus tone="muted">{periodLabel}</RailStatus>;
}

export default function Home() {
  const tokens = useTokens();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [exams, setExams] = useState<UpcomingExam[] | null>(null);
  const [results, setResults] = useState<PublishedResult[] | null>(null);
  const [slots, setSlots] = useState<TimetableSlot[] | null>(null);
  const [diary, setDiary] = useState<StudentDiaryResult | null>(null);
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
        // A remark waiting for a signature is the most time-sensitive thing on
        // this screen, so the diary is part of the same load, not a lazy tab.
        api.request<StudentDiaryResult>('/me/diary'),
      ])
        .then(([p, a, att, ex, res, tt, d]) => {
          if (cancelled) return;
          setProfile(p);
          setAnnouncements(a);
          setAttendance(att);
          setExams(ex);
          setResults(res);
          setSlots(tt);
          setDiary(d);
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
  // How far through the live period we are — the length of THE INK LINE under
  // the current row. Only the live row gets one.
  const livePercent = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 0;

  function railState(s: TimetableSlot): 'past' | 'now' | 'upcoming' {
    if (currentSlot?.id === s.id) return 'now';
    return minutesOfDay(s.period.endTime) <= now ? 'past' : 'upcoming';
  }

  return (
    <Screen>
      <Dateline />

      {/* `.greet` + `.kidchip` — the greeting in the diary serif, with the
          bell and the student's initial pushed to the right margin. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 2 }}>
        <Text style={{ fontFamily: font.serif, fontSize: 20, color: tokens.color.ink, flex: 1 }}>
          {profile ? `Hi, ${profile.firstName} 👋` : 'Home'}
        </Text>
        <NotificationBell group="(family)" />
        <SettingsButton group="(family)" />
        {profile && (
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: tokens.color.indigo,
            }}
          >
            <Text style={{ fontFamily: font.serif, fontSize: 13, fontWeight: '700', color: tokens.color.onBrand }}>
              {profile.firstName.slice(0, 1)}
            </Text>
          </View>
        )}
      </View>

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

          {/* An unsigned remark outranks everything else here: it is the one
              thing on this screen someone at home has to DO, and it came with
              an email that has already landed.
              It is a CARD, not a `Page` + `PageHeader`: a page heading has
              room for a title and nothing else, so the repaint's version lost
              the line that says what to do about it, and nested a second
              Pressable ("Sign ›") inside the banner's own. */}
          {diary && diary.unsignedCount > 0 && (
            <Pressable testID="diary-banner" onPress={() => router.push('/(family)/diary')}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: tokens.color.red50,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 17 }}>📔</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 13.5, color: tokens.color.ink }}>
                    {diary.unsignedCount === 1
                      ? 'A diary remark to sign'
                      : `${diary.unsignedCount} diary remarks to sign`}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                    Open the diary to read and sign.
                  </Text>
                </View>
                <Pill tone="red">Sign</Pill>
              </Card>
            </Pressable>
          )}

          {/* Next-test reminder — the thing a student should never miss.
              A test that has been SCHEDULED is something that arrived, so it
              is a pinned notice. Tapping it opens the full detail (syllabus,
              max marks, date) on Results. */}
          {nextExam && (
            <Notice
              testID="next-exam-banner"
              icon="🔔"
              tint={tokens.color.amber50}
              title={`${nextExam.subjectName} · ${nextExam.title} — ${daysUntilLabel(nextExam.scheduledAt).toLowerCase()}`}
              detail={`${formatDate(nextExam.scheduledAt)}${nextExam.syllabus ? ` · ${nextExam.syllabus}` : ''} · out of ${nextExam.maxMarks}`}
              onPress={() => router.push('/(family)/results')}
            />
          )}

          {/* At-a-glance KPIs. Only two — "today" is already the hero's status
              chip and "next test" is the notice above, so repeating them would
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
              <Page>
                <PageHeader
                  title="Today's classes"
                  actionLabel="Full week"
                  onAction={() => router.push('/(family)/timetable')}
                />
                {todaySlots.map((s, i) => {
                  const state = railState(s);
                  return (
                    <RailRow
                      key={s.id}
                      startTime={s.period.startTime}
                      endTime={s.period.endTime}
                      title={s.subject.name}
                      subtitle={fullTeacherName(s.teacher)}
                      state={state === 'past' ? 'done' : state === 'now' ? 'now' : 'upcoming'}
                      first={i === 0}
                      right={railStatusFor(state, s.period.label)}
                      inkPercent={state === 'now' ? livePercent : undefined}
                    />
                  );
                })}
              </Page>
              {/* NO attendance "receipt" chip here. The repaint added a green
                  chip with a green TICK stroking itself on — and rendered it
                  for ABSENT too, so a day the register marked absent read as a
                  green tick. Today's status is already stated honestly, in its
                  own colour, by the hero above; a second copy of it that can
                  only ever be green is worse than no copy at all. */}
            </>
          )}

          <SectionTitle title="Latest announcements" />
          {latestAnnouncements.length === 0 ? (
            <Card>
              <Text style={{ color: tokens.color.sub }}>No announcements yet.</Text>
            </Card>
          ) : (
            latestAnnouncements.map((a) => (
              <Notice
                key={a.id}
                icon="📣"
                tint={tokens.color.indigo50}
                title={a.title}
                detail={`${a.classSectionId ? 'Your class' : 'Whole school'} · ${relativeTime(a.createdAt)}`}
                onPress={() => router.push('/(family)/notices')}
              />
            ))
          )}
        </>
      )}
    </Screen>
  );
}
