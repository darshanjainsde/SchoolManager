import { useCallback, useState, type ReactNode } from 'react';
import { Animated, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { StudentDiaryResult, TimetableSlot } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import { minutesOfDay } from '@/lib/teacher-day';
import { useNowMinutes } from '@/lib/use-now-minutes';
import {
  relativeTime,
  type Announcement,
  type AttendanceSummary,
  type PublishedResult,
  type StudentProfile,
  type UpcomingExam,
} from '@/lib/portal';
import { Card, Page, PageHeader, RailRow, RailStatus, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { NotificationBell } from '@/components/NotificationBell';
import { HomeToolGrid } from '@/components/HomeToolGrid';
import { Touchable } from '@/components/Touchable';
import { Icon, isIconName } from '@/components/icons';
import { StudentHero } from '@/components/StudentHero';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, pinStyle, useGesture } from '@/theme/motion';

/** How many of the most recent announcements the home screen surfaces (the full list lives on Notices). */
const LATEST_ANNOUNCEMENTS_COUNT = 3;

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
  iconColor,
  tint,
  title,
  detail,
  onPress,
  testID,
}: {
  /** A duotone glyph name from components/icons.tsx — drawn, never an emoji. */
  icon: string;
  iconColor: string;
  tint: string;
  title: string;
  detail: string;
  onPress?: () => void;
  testID?: string;
}) {
  const tokens = useTokens();
  const pin = useGesture(true, DUR.pin, { native: true });
  const card = (
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
            {isIconName(icon) && <Icon name={icon} size={17} color={iconColor} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{title}</Text>
            <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>{detail}</Text>
      </View>
    </Card>
  );
  return (
    <Animated.View style={pinStyle(pin)}>
      {/* A notice with nowhere to go is a card, not a button. Wrapping it
          anyway would give it a press animation, a haptic tick and a "button"
          role in the accessibility tree for a tap that does nothing. */}
      {onPress ? (
        <Touchable testID={testID} onPress={onPress} accessibilityLabel={`${title}. ${detail}`}>
          {card}
        </Touchable>
      ) : (
        <View testID={testID}>{card}</View>
      )}
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
  const tile = {
    flex: 1,
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  } as const;
  const body = (
    <>
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
    </>
  );
  // Same rule as Notice above: a figure you cannot open is a figure, not a
  // button. Several of these tiles are read-only by design.
  if (!onPress) return <View style={tile}>{body}</View>;
  return (
    <Touchable
      onPress={onPress}
      accessibilityLabel={hint ? `${label}, ${value}, ${hint}` : `${label}, ${value}`}
      style={tile}
    >
      {body}
    </Touchable>
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
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * ONE definition of "load this screen", used by both the focus effect and the
   * pull gesture — two copies of a seven-request list would drift the moment
   * one of them gained an eighth.
   *
   * Resolves to a function that applies the results, so the CALLER decides
   * whether to apply them: the focus effect drops them if it has been
   * cancelled, the pull always applies.
   */
  const fetchAll = useCallback(
    () =>
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
        // The Messages dome's badge (pitch №4). catch → 0: a badge must never
        // fail the whole home load.
        api.request<{ count: number }>('/me/messages/unread-count').catch(() => ({ count: 0 })),
      ]).then(([p, a, att, ex, res, tt, d, um]) => () => {
        setProfile(p);
        setAnnouncements(a);
        setAttendance(att);
        setExams(ex);
        setResults(res);
        setSlots(tt);
        setDiary(d);
        setUnreadMsgs(um.count);
      }),
    [],
  );

  /** Pull to refresh. Nothing is cleared first — see the staff twin. */
  function refresh() {
    setRefreshing(true);
    setError(null);
    fetchAll()
      .then((apply) => apply())
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => setRefreshing(false));
  }

  // Refetch on focus: a new notice, a fresh attendance mark, a newly scheduled
  // test/result, or simply time passing (a class ending) should all be
  // reflected the moment the family tab regains focus, not just on cold start.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      fetchAll()
        .then((apply) => {
          if (cancelled) return;
          apply();
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, [fetchAll]),
  );

  const today = todayISO();
  const todayStatus = attendance?.days.find((d) => d.date === today)?.status ?? null;
  const attendanceMarked = attendance ? attendance.present + attendance.absent + attendance.late : 0;
  const nextExam = exams?.[0] ?? null;
  const latestResult = results?.[0] ?? null;
  const latestAnnouncements = (announcements ?? []).slice(0, LATEST_ANNOUNCEMENTS_COUNT);

  // Today's schedule, derived client-side from the weekly timetable (there is
  // no per-day endpoint — the whole week comes from /me/timetable).
  // Ticks on the minute — the "now" rule moves down the day on its own
  // rather than freezing wherever the screen happened to be opened.
  const now = useNowMinutes();
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
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Dateline />

      {/* `.greet` + `.kidchip` — the greeting in the diary serif, with the
          bell and the student's initial pushed to the right margin. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 2 }}>
        {/* Same bold-serif treatment as the staff greeting: the name is set
            like a title, not a form value. */}
        <Text
          style={{
            fontFamily: font.serif,
            fontSize: 20,
            fontWeight: '700',
            letterSpacing: -0.3,
            color: tokens.color.ink,
            flex: 1,
          }}
        >
          {profile ? `Hi, ${profile.firstName} 👋` : 'Home'}
        </Text>
        <NotificationBell group="(family)" />
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
        <LoadingRows label="Loading your details…" rows={3} />
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

          {/* NEEDS YOU TODAY (pitch №4) — the family's asks as badged domes,
              replacing the old diary banner card + next-test notice row. An
              unsigned remark still outranks everything: the Diary dome is the
              one LIT thing on this screen while any wait, and its badge is the
              count. Next test rides as the Results badge — the fact stays
              tappable, the full detail (date, syllabus, marks) lives one tap
              away on Results where it always did. */}
          <Text style={familyEyebrow(tokens)}>Needs you today</Text>
          <HomeToolGrid
            testID="grid-needs"
            tools={[
              {
                label: 'Diary',
                icon: 'diary',
                route: '/(family)/diary',
                tone: 'amber',
                badge: diary?.unsignedCount ?? 0,
                live: (diary?.unsignedCount ?? 0) > 0,
              },
              { label: 'Messages', icon: 'messages', route: '/(family)/messages', tone: 'amber', badge: unreadMsgs },
              { label: 'Assignments', icon: 'assignments', route: '/(family)/assignments' },
              { label: 'Results', icon: 'results', route: '/(family)/results', badge: nextExam ? 1 : 0 },
            ]}
          />

          {/* The rule between "asked of you" and "merely available". */}
          <View style={{ borderTopWidth: 1, borderTopColor: tokens.color.line, marginHorizontal: 2 }} />

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

          {/* GO TO — everything merely available, the family twin of the
              staff block. The four tools with asks moved up to Needs-you-today. */}
          <Text style={familyEyebrow(tokens)}>Go to</Text>
          <HomeToolGrid
            testID="grid-goto"
            tools={[
              { label: 'Timetable', icon: 'timetable', route: '/(family)/timetable' },
              { label: 'Notices', icon: 'notices', route: '/(family)/notices', tone: 'amber' },
              { label: 'Holidays', icon: 'holidays', route: '/(family)/holidays', tone: 'green' },
            ]}
          />

          <SectionTitle title="Latest announcements" />
          {latestAnnouncements.length === 0 ? (
            <Card>
              <Text style={{ color: tokens.color.sub }}>No announcements yet.</Text>
            </Card>
          ) : (
            latestAnnouncements.map((a) => (
              <Notice
                key={a.id}
                icon="notices"
                iconColor={tokens.color.indigo}
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

/** The small letter-spaced label that titles a block on Home. */
function familyEyebrow(tokens: ReturnType<typeof useTokens>) {
  return {
    marginHorizontal: 4,
    marginBottom: -2,
    fontSize: 10,
    letterSpacing: 1.3,
    textTransform: 'uppercase' as const,
    fontWeight: '700' as const,
    color: tokens.color.sub,
  };
}
