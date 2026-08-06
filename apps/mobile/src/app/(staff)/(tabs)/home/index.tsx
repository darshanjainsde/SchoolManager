import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { TeacherDay, TeacherDayEntry } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { session } from '@/lib/session';
import { todayISO } from '@/lib/attendance';
import { currentEntry, minutesOfDay } from '@/lib/teacher-day';
import { useNowMinutes } from '@/lib/use-now-minutes';
import { NowCard } from '@/components/NowCard';
import { DayTimeline } from '@/components/DayTimeline';
import { ClassNotesPanel } from '@/components/ClassNotesPanel';
import { Card, Screen } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { NotificationBell } from '@/components/NotificationBell';
import { HomeToolGrid } from '@/components/HomeToolGrid';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { salutation } from '@/lib/greeting';

export default function Today() {
  const tokens = useTokens();
  const [name, setName] = useState<string | null>(null);
  const [day, setDay] = useState<TeacherDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Unread message count for the "Needs you today" badge. Best-effort like the
  // bell's own count: a badge must never surface an error, so failures leave 0.
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const date = todayISO();

  /**
   * The pull gesture reloads the day. Deliberately does NOT clear `day` first:
   * blanking the screen to reload it is how a refresh comes to feel slower than
   * doing nothing, so the old day stays on screen until the new one lands.
   */
  function refresh() {
    setRefreshing(true);
    setError(null);
    api
      .request<TeacherDay>(`/manage/timetable/my-day?date=${encodeURIComponent(date)}`)
      .then(setDay)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => setRefreshing(false));
  }

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      session.get().then((s) => {
        if (!cancelled) setName(s?.displayName ?? null);
      });
      api
        .request<{ count: number }>('/manage/messages/unread-count')
        .then((r) => {
          if (!cancelled) setUnreadMsgs(r.count);
        })
        .catch(() => {
          /* a badge must never surface an error */
        });
      api
        .request<TeacherDay>(`/manage/timetable/my-day?date=${encodeURIComponent(date)}`)
        .then((data) => {
          if (!cancelled) setDay(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
      // date is always "today" for this screen (no date picker here — see
      // apps/mobile/src/app/(staff)/attendance.tsx for that), so it is
      // deliberately not a dependency: the effect still reruns on every
      // focus, which is what keeps a colleague's mark visible without a
      // manual reload.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const entries = day?.entries ?? [];
  // Ticks on the minute (see lib/use-now-minutes.ts). Everything derived below
  // — which period is live, how far through it we are, which register is still
  // open, what the timeline highlights — recomputes with it, so the screen
  // stays honest without the teacher having to leave it and come back.
  const now = useNowMinutes();
  const { index, entry, elapsed, total } = currentEntry(entries, now);
  // The first entry (chronologically) that hasn't started yet — this works
  // uniformly whether nothing is current (before school / a gap) or a class
  // or break is current right now (its own start is <= now, so it's skipped).
  const nextEntry = entries.find((e) => minutesOfDay(e.startTime) > now) ?? null;

  // Only real lessons count as "classes" — a FREE period is a teaching slot
  // the teacher holds no class in, and a BREAK isn't a class at all, so both
  // are excluded from the glance stats and the day-complete wrap-up.
  const classes = entries.filter((e) => e.kind === 'CLASS');
  const taken = classes.filter((e) => e.register?.taken).length;
  const pending = classes.length - taken;
  const studentsMarked = classes.reduce((sum, e) => sum + (e.register?.present ?? 0), 0);
  // The queue: every class whose register is still open, in the order the day
  // runs — the one that is live (or overdue) is simply the one nearest the top.
  const needsInk = classes.filter((e) => !e.register?.taken && e.slot);

  function goToAttendance(classSectionId: string) {
    const className = entries.find((e) => e.slot?.classSectionId === classSectionId)?.slot?.className;
    const nameParam = className ? `?name=${encodeURIComponent(className)}` : '';
    router.push(`/(staff)/take/${classSectionId}${nameParam}`);
  }

  /**
   * Open the class itself. Everything the class screen shows in its header —
   * the subject, the period, its clock times, who marked the register — is
   * already on the entry Home is holding, so it travels as params rather than
   * being refetched from an endpoint that would have to be invented.
   */
  function goToClass(classSectionId: string) {
    const e = entries.find((x) => x.slot?.classSectionId === classSectionId);
    const params = new URLSearchParams();
    if (e?.slot?.className) params.set('name', e.slot.className);
    if (e?.slot?.subjectName) params.set('subject', e.slot.subjectName);
    if (e?.label) params.set('period', e.label);
    if (e?.startTime) params.set('start', e.startTime);
    if (e?.endTime) params.set('end', e.endTime);
    if (e?.register?.markedBy) params.set('takenBy', e.register.markedBy);
    router.push(`/(staff)/(tabs)/home/class/${classSectionId}?${params.toString()}`);
  }

  function isLive(e: TeacherDayEntry): boolean {
    return entry?.periodId === e.periodId;
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      {/* `.greet` + `.kidchip` — the teacher's name in the diary serif, the
          bell out in the right margin.

          Two lines, not one: the greeting is the same every morning, the NAME
          is the part that is theirs. Setting the salutation as a small
          letter-spaced eyebrow lets the name take the full serif line at a size
          that reads as a title, instead of both sharing one 20px run where the
          name is just the tail of a sentence. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 2 }}>
        <View style={{ flex: 1 }}>
          <Text
            maxFontSizeMultiplier={1.4}
            style={{
              fontSize: 11,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: tokens.color.sub,
              marginBottom: 1,
            }}
          >
            {salutation()}
          </Text>
          <Text
            maxFontSizeMultiplier={1.4}
            numberOfLines={1}
            // Bold serif with a touch of negative tracking: the NAME is the
            // one personal thing on this screen, so it is set like a book
            // title, not a form value.
            style={{
              fontFamily: font.serif,
              fontSize: 26,
              lineHeight: 31,
              fontWeight: '700',
              letterSpacing: -0.4,
              color: tokens.color.ink,
            }}
          >
            {name ?? 'Today'}
          </Text>
        </View>
        {/* One bell, no gear (pitch №3): appearance lives in Profile, and the
            gear pointed at a settings screen that held nothing else. The bell
            centres itself on this two-line block via its own alignSelf. */}
        <NotificationBell group="(staff)" />
      </View>

      {/* The day in one line, in the pitch's `.gatesub` voice — a note under
          the greeting rather than a card competing with the hero below it. */}
      <Text style={{ marginHorizontal: 4, marginTop: -2, fontSize: 12, color: tokens.color.sub }}>
        {day === null && !error
          ? 'Loading your day…'
          : `${classes.length} class${classes.length === 1 ? '' : 'es'} today · ${taken} taken · ${pending} pending`}
      </Text>

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}

      {/* The caption above still carries the sentence, because it IS a sentence
          — it becomes "3 classes today · 1 taken · 2 pending", not a list. What
          was missing is the shape of everything below it: the hero, then the
          day. Home is the screen a teacher opens on a corridor connection, so
          it is the one where an empty page for two seconds reads as broken. */}
      {day === null && !error && <LoadingRows label="Loading your day…" rows={4} />}

      {day !== null && !error && entries.length === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            No timetable has been set up for you yet — ask your school admin.
          </Text>
        </Card>
      )}

      {day !== null && !error && entries.length > 0 && (
        <>
          <NowCard
            entry={entry}
            elapsed={elapsed}
            total={total}
            nextEntry={nextEntry}
            onTakeAttendance={goToAttendance}
            onOpenClass={goToClass}
            summary={{ classesTaught: classes.length, studentsMarked }}
          />

          {entry?.kind === 'CLASS' && entry.slot && (
            <ClassNotesPanel
              classSectionId={entry.slot.classSectionId}
              date={date}
              subjectId={entry.slot.subjectId}
              subjectName={entry.slot.subjectName}
            />
          )}

          {/* NEEDS YOU TODAY (pitch №3) — the tools carrying today's asks, as
              badged domes instead of the old five-row "Needs your ink" list
              (which said "register — not taken" five different ways). The
              Registers dome carries the open-register count and lights amber
              while a register is live RIGHT NOW — still the only filled thing
              on this screen. Nothing is lost with the list: Registers lands on
              the Attendance tab (the full class list), and the day timeline
              below still shows every period's register state in place. */}
          <Text style={eyebrow(tokens)}>Needs you today</Text>
          <HomeToolGrid
            testID="grid-needs"
            tools={[
              {
                label: 'Registers',
                icon: 'take',
                route: '/(staff)/(tabs)/attendance',
                tone: 'amber',
                badge: needsInk.length,
                live: needsInk.some((e) => isLive(e)),
              },
              { label: 'Messages', icon: 'messages', route: '/(staff)/(tabs)/home/messages', tone: 'amber', badge: unreadMsgs },
              { label: 'Diary', icon: 'diary', route: '/(staff)/(tabs)/home/diary' },
              { label: 'Requests', icon: 'requests', route: '/(staff)/(tabs)/home/requests', tone: 'amber' },
            ]}
          />

          {/* The rule between "asked of you" and "merely available". */}
          <View style={{ borderTopWidth: 1, borderTopColor: tokens.color.line, marginHorizontal: 2 }} />

          {/* GO TO — every remaining tab as an icon; navigation, nothing else. */}
          <Text style={eyebrow(tokens)}>Go to</Text>
          <HomeToolGrid
            testID="grid-goto"
            tools={[
              { label: 'Assignments', icon: 'assignments', route: '/(staff)/(tabs)/home/assignments' },
              { label: 'Notes', icon: 'notes', route: '/(staff)/(tabs)/home/notes' },
              { label: 'Tests & Results', icon: 'results', route: '/(staff)/(tabs)/home/tests' },
              { label: 'Announce', icon: 'notices', route: '/(staff)/(tabs)/home/post', tone: 'amber' },
              { label: 'Holidays', icon: 'holidays', route: '/(staff)/(tabs)/home/holidays', tone: 'green' },
            ]}
          />

          <DayTimeline entries={entries} currentIndex={index} onTakeAttendance={goToAttendance} />
        </>
      )}
    </Screen>
  );
}

/** The small letter-spaced label that titles a block on Home. */
function eyebrow(tokens: ReturnType<typeof useTokens>) {
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
