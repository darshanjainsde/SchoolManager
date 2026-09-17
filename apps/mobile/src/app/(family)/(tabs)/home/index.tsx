import { type ReactNode } from 'react';
import { Animated, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { PortalHome, TimetableSlot } from '@skoolos/types';
import { useQuery } from '@/lib/query';
import { useSession } from '@/lib/use-session';
import { hasFeature } from '@/lib/features';
import { MORE_ITEMS } from '@/lib/family-nav';
import type { StudentFees } from '@/lib/fees';
import type { BirthdaysResult } from './birthdays';
import { todayISO } from '@/lib/attendance';
import { minutesOfDay } from '@/lib/teacher-day';
import { useNowMinutes } from '@/lib/use-now-minutes';
import { relativeTime } from '@/lib/portal';
import { Card, ErrorState, Figure, Page, PageHeader, RailRow, RailStatus, Screen, SectionTitle } from '@/components/ui';
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

/** The word in a period row's right-hand `.st` slot. */
function railStatusFor(state: 'past' | 'now' | 'upcoming', periodLabel: string): ReactNode {
  if (state === 'now') return <RailStatus tone="now">now</RailStatus>;
  if (state === 'past') return <RailStatus tone="good">✓</RailStatus>;
  return <RailStatus tone="muted">{periodLabel}</RailStatus>;
}

export default function Home() {
  const tokens = useTokens();
  const s = useSession();
  // ONE request for the page (second edition, D1): /me/home composes the seven
  // sections the individual routes still serve. The cache shows the last
  // answer instantly on focus and refetches behind it; a skeleton only ever
  // appears on a cold start.
  const home = useQuery<PortalHome>('/me/home');
  // The Messages dome's badge. Best-effort: a badge must never fail the page.
  const unread = useQuery<{ count: number }>('/me/messages/unread-count');
  // The Fees dome's badge — late bills — only for a school on the module.
  const fees = useQuery<StudentFees>(hasFeature(s, 'FEES') ? '/me/fees' : null);
  // The wall, for the one day it matters. A 404 (wall off) is a quiet null.
  const wall = useQuery<BirthdaysResult>('/me/birthdays');

  const profile = home.data?.profile ?? null;
  const announcements = home.data?.announcements ?? null;
  const attendance = home.data?.attendance ?? null;
  const exams = home.data?.exams ?? null;
  const results = home.data?.results ?? null;
  const slots = home.data?.timetable ?? null;
  const diary = home.data?.diary ?? null;
  const unreadMsgs = unread.data?.count ?? 0;
  const error = home.error && !home.data ? home.error : null;
  const refreshing = home.refreshing;

  /** Pull to refresh. Nothing is cleared first — the old page stays until the new one lands. */
  function refresh() {
    home.refresh();
    unread.reload();
    fees.reload();
    wall.reload();
  }

  const lateBills = fees.data ? fees.data.invoices.filter((i) => !i.isPaid && i.isOverdue).length : 0;
  const myBirthday = profile && wall.data ? isMyBirthday(wall.data, profile) : false;

  const today = todayISO();
  const todayStatus = attendance?.days.find((d) => d.date === today)?.status ?? null;
  const attendanceMarked = attendance ? attendance.present + attendance.absent + attendance.late : 0;
  const nextExam = exams?.[0] ?? null;
  const latestResult = results?.[0] ?? null;
  const latestAnnouncements = (announcements ?? []).slice(0, LATEST_ANNOUNCEMENTS_COUNT);

  // Today's schedule, derived client-side from the weekly timetable (there is
  // no per-day endpoint — the whole week comes with /me/home).
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
      {/* On the child's birthday the dateline becomes the banner — the only
          thing on the page that changes, in the amber the day is allowed. */}
      {myBirthday && profile ? <BirthdayBanner firstName={profile.firstName} /> : <Dateline />}

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
          {profile ? `Hi, ${profile.firstName}` : 'Home'}
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

      {error && <ErrorState error={error} onRetry={home.reload} />}
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
                route: '/(family)/(tabs)/home/diary',
                tone: 'amber',
                badge: diary?.unsignedCount ?? 0,
                live: (diary?.unsignedCount ?? 0) > 0,
              },
              { label: 'Messages', icon: 'messages', route: '/(family)/(tabs)/home/messages', tone: 'amber', badge: unreadMsgs },
              { label: 'Assignments', icon: 'assignments', route: '/(family)/(tabs)/home/assignments' },
              { label: 'Results', icon: 'results', route: '/(family)/results', badge: nextExam ? 1 : 0 },
              // Fees asks only when a bill is LATE — the badge is the count of
              // late bills, and the dome's fill stays reserved for the diary.
              ...(hasFeature(s, 'FEES')
                ? [{ label: 'Fees', icon: 'fees', route: '/(family)/(tabs)/fees', tone: 'amber' as const, badge: lateBills }]
                : []),
            ]}
          />

          {/* The rule between "asked of you" and "merely available". */}
          <View style={{ borderTopWidth: 1, borderTopColor: tokens.color.line, marginHorizontal: 2 }} />

          {/* At-a-glance KPIs. Only two — "today" is already the hero's status
              chip and "next test" is the notice above, so repeating them would
              be noise. Both tiles deep-link to their full screen. */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Figure
              label="This month"
              value={attendanceMarked > 0 ? `${attendance?.percent}%` : 'No records'}
              hint={attendanceMarked > 0 ? `${attendance?.present} of ${attendanceMarked} days present` : undefined}
              tone={attendance && attendanceMarked > 0 && attendance.percent < 75 ? 'warn' : undefined}
              onPress={() => router.push('/(family)/attendance')}
            />
            <Figure
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
                  onAction={() => router.push('/(family)/(tabs)/home/timetable')}
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
              { label: 'Timetable', icon: 'timetable', route: '/(family)/(tabs)/home/timetable' },
              { label: 'Notices', icon: 'notices', route: '/(family)/(tabs)/home/notices', tone: 'amber' },
              { label: 'Holidays', icon: 'holidays', route: '/(family)/(tabs)/home/holidays', tone: 'green' },
              // The four the web portal had first (second edition). A paid
              // module's tool is drawn only for a school that has it.
              ...MORE_ITEMS.filter((t) => ['Sports', 'Library', 'Report cards', 'Birthdays'].includes(t.label))
                .filter((t) => !t.feature || hasFeature(s, t.feature))
                .map((t) => ({ label: t.label, icon: t.icon, route: t.route, tone: t.tone })),
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
                onPress={() => router.push('/(family)/(tabs)/home/notices')}
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

/** Does the wall carry a row for THIS child? The wall has no ids by design — match on the name and class the app already knows. */
export function isMyBirthday(wall: BirthdaysResult, p: { firstName: string; lastName: string; className: string | null }): boolean {
  const full = `${p.firstName} ${p.lastName}`.trim().toLowerCase();
  const first = p.firstName.trim().toLowerCase();
  const initial = p.lastName.trim() ? `${first} ${p.lastName.trim()[0].toLowerCase()}.` : first;
  return wall.today.some((r) => {
    const n = r.name.trim().toLowerCase();
    const nameHit = n === full || n === initial || n === first;
    const classHit = !r.classLabel || !p.className || r.classLabel.toLowerCase() === p.className.toLowerCase();
    return nameHit && classHit;
  });
}

/**
 * THE ONE DAY. Bunting in the brand's amber, indigo and margin red; the
 * greeting in the diary serif. The app's own voice turned up, not a
 * different product for a day — and no motion, because a birthday is a
 * day's state, not an event that just happened.
 */
function BirthdayBanner({ firstName }: { firstName: string }) {
  const tokens = useTokens();
  const flags = [tokens.color.amber, tokens.color.indigo, tokens.color.marginRed, tokens.color.amber, tokens.color.indigo, tokens.color.marginRed, tokens.color.amber];
  return (
    <View
      testID="birthday-banner"
      accessibilityRole="header"
      accessibilityLabel={`Happy birthday, ${firstName}`}
      style={{
        backgroundColor: tokens.color.amber50,
        borderColor: tokens.color.amber,
        borderWidth: 1,
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 14,
        alignItems: 'center',
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {flags.map((c, i) => (
          <View key={i} style={{ width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 11, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: c }} />
        ))}
      </View>
      <Text style={{ fontFamily: font.serif, fontStyle: 'italic', fontSize: 21, fontWeight: '600', color: tokens.color.ink, textAlign: 'center' }}>
        Happy birthday, {firstName}
      </Text>
      <Text style={{ fontSize: 11.5, color: tokens.color.ink2, textAlign: 'center' }}>Your class can see it on the school’s wall today.</Text>
    </View>
  );
}
