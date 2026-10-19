import { fetchCached, readCache, useQuery, useReload } from '@/lib/query';
import { onAskAgain } from '@/lib/cache-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { BandGreeting } from '@/components/BandHeader';
import type { ClassNoteRow, ClassTodoRow, TeacherDay } from '@skoolos/types';
import { ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import { currentEntry, minutesOfDay } from '@/lib/teacher-day';
import { useNowMinutes } from '@/lib/use-now-minutes';
import { NowCard } from '@/components/NowCard';
import { DayTimeline } from '@/components/DayTimeline';
import { PeriodSheet } from '@/components/PeriodSheet';
import { Card, ErrorState, Screen } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { NotificationBell } from '@/components/NotificationBell';
import { HomeMenu } from '@/components/HomeToolGrid';
import { useTokens } from '@/theme/theme-context';
import { fmtLongDay } from '@/lib/dates';
import { hasFeature } from '@/lib/features';
import { useSession } from '@/lib/use-session';
import { useFirstPaint } from '@/lib/use-first-paint';
import { QuickActions } from '@/components/QuickActions';
import { DoNow, type DoNowItem } from '@/components/DoNow';

export default function Today() {
  const tokens = useTokens();
  const s = useSession();
  // Try again / pull-to-refresh for this screen's own focus effect.
  const [reloadKey, reload] = useReload();
  const date = todayISO();
  const dayPath = `/manage/timetable/my-day?date=${encodeURIComponent(date)}`;
  const unreadPath = '/manage/messages/unread-count';
  // CACHE FIRST (perf, 19 Oct 2026). The day and the message badge used to be
  // plain requests on every focus, so every visit to Home opened on the
  // skeleton. Both now go through the app's one cache (lib/query.ts): a
  // revisit paints the last answer at once and asks again behind it.
  //
  // Unlike useQuery's FRESH_MS window, the DAY is asked again on EVERY focus:
  // a colleague marking a register elsewhere must show up the next time this
  // screen is looked at, and the cached answer is what keeps that free of a
  // skeleton. The shared inflight map still folds duplicate asks into one.
  const [day, setDay] = useState<TeacherDay | null>(() => readCache<TeacherDay>(dayPath) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Unread message count for the "Needs you today" badge. Best-effort like the
  // bell's own count: a badge must never surface an error, so failures leave 0.
  const [unreadMsgs, setUnreadMsgs] = useState(() => readCache<{ count: number }>(unreadPath)?.count ?? 0);
  // Whether the badge's first answer is in — held with the day for ONE first frame.
  const [unreadSettled, setUnreadSettled] = useState(() => readCache(unreadPath) !== undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const askDay = useCallback(() => {
    const had = readCache<TeacherDay>(dayPath);
    if (had !== undefined) setDay(had);
    return fetchCached<TeacherDay>(dayPath)
      .then((data) => {
        if (!alive.current) return;
        setDay(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (alive.current) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      });
  }, [dayPath]);

  const askUnread = useCallback(() => {
    fetchCached<{ count: number }>(unreadPath)
      .then((r) => {
        if (alive.current) setUnreadMsgs(r.count);
      })
      .catch(() => {
        /* a badge must never surface an error */
      })
      .finally(() => {
        if (alive.current) setUnreadSettled(true);
      });
  }, []);

  /**
   * The pull gesture reloads the day. Deliberately does NOT clear `day` first:
   * blanking the screen to reload it is how a refresh comes to feel slower than
   * doing nothing, so the old day stays on screen until the new one lands.
   */
  function refresh() {
    setRefreshing(true);
    setError(null);
    askUnread();
    void askDay().finally(() => {
      if (alive.current) setRefreshing(false);
    });
  }

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      setError(null);
      askUnread();
      void askDay();
      // date is always "today" for this screen (no date picker here — see
      // apps/mobile/src/app/(staff)/attendance.tsx for that), so it is
      // deliberately not a dependency: the effect still reruns on every
      // focus, which is what keeps a colleague's mark visible without a
      // manual reload.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey]),
  );

  // Back from the background, or a push said something changed: ask again,
  // the same signal every useQuery on this screen already listens to.
  useEffect(
    () =>
      onAskAgain(() => {
        if (!alive.current) return;
        askUnread();
        void askDay();
      }),
    [askDay, askUnread],
  );

  const entries = day?.entries ?? [];
  // Ticks on the minute (see lib/use-now-minutes.ts). Everything derived below
  // — which period is live, how far through it we are, which register is still
  // open, what the timeline highlights — recomputes with it, so the screen
  // stays honest without the teacher having to leave it and come back.
  const now = useNowMinutes();
  const { index, entry, elapsed, total } = currentEntry(entries, now);
  const liveSlot = entry?.kind === 'CLASS' ? entry.slot : null;

  // THE PERIOD KIT's counts (pitch №6). Same endpoint the sheet's panel uses,
  // fetched thin here just to badge the tiles: notes = today's count, to-dos =
  // the REMAINING count. Best-effort like every badge — failures leave 0.
  const [periodCounts, setPeriodCounts] = useState({ notes: 0, todosLeft: 0 });
  const [sheet, setSheet] = useState<null | 'notes' | 'todos'>(null);
  const liveClassSectionId = liveSlot?.classSectionId ?? null;
  const liveSubjectId = liveSlot?.subjectId ?? null;
  const refreshPeriodCounts = useCallback(() => {
    if (!liveClassSectionId || !liveSubjectId) return;
    // Through the inflight map: the mount effect and the focus effect both
    // ask on mount, and used to issue two real requests (perf audit #12).
    const path = `/manage/class-notes?classSectionId=${encodeURIComponent(liveClassSectionId)}&date=${encodeURIComponent(date)}&subjectId=${encodeURIComponent(liveSubjectId)}`;
    const toCounts = (d: { notes: ClassNoteRow[]; todos: ClassTodoRow[] }) => ({
      notes: d.notes.length,
      todosLeft: d.todos.filter((t) => !t.done).length,
    });
    // The last answer first, so a revisit badges the kit at once.
    const had = readCache<{ notes: ClassNoteRow[]; todos: ClassTodoRow[] }>(path);
    if (had) setPeriodCounts(toCounts(had));
    fetchCached<{ notes: ClassNoteRow[]; todos: ClassTodoRow[] }>(path)
      .then((d) => setPeriodCounts(toCounts(d)))
      .catch(() => {
        /* a badge must never surface an error */
      });
    // `date` is always "today" here — see the note on the focus effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveClassSectionId, liveSubjectId]);
  // Refetch when the bell flips the live period, and on every focus (a note
  // added from the Notes tool elsewhere must show up on the badge).
  useEffect(() => {
    setPeriodCounts({ notes: 0, todosLeft: 0 });
    refreshPeriodCounts();
  }, [refreshPeriodCounts]);
  useFocusEffect(
    useCallback(() => {
      refreshPeriodCounts();
    }, [refreshPeriodCounts]),
  );
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

  // ONE first frame: the day is the page; the message badge gets a moment to
  // land with it, so nothing pops in after.
  // How far each of my classes is through its syllabus — only where the owner switched the tracker on.
  const syllabusOn = hasFeature(s, 'COURSE_MANAGEMENT');
  const mine = useQuery<{ tracks: Array<{ leaves: number; done: number }> }>(syllabusOn ? '/manage/syllabus/mine' : null);
  // New concerns from the class teacher's families — best-effort like every
  // badge: a teacher who is not a class teacher simply gets nothing.
  const concerns = useQuery<{ unread: number }>('/teacher/concerns/counts');
  const newConcerns = concerns.data?.unread ?? 0;
  // The live period's counts are NOT held for: they need the day first (to know
  // which period is live), so waiting for them chained a second round-trip
  // onto the first frame. The kit badges arrive a beat after the page.
  const painted = useFirstPaint(day !== null || error !== null, [!unreadSettled, mine.loading, concerns.loading]);

  const syllabusPct = (() => {
    const leaves = (mine.data?.tracks ?? []).reduce((sum, t) => sum + t.leaves, 0);
    const done = (mine.data?.tracks ?? []).reduce((sum, t) => sum + t.done, 0);
    return leaves > 0 ? Math.round((done / leaves) * 100) : null;
  })();
  // The band says the day in one plain sentence (user, 19 Oct 2026: the rings
  // and their figures went; "remove this rings completely").
  const nextClass = classes.find((e) => minutesOfDay(e.startTime) > now);
  const openNow = needsInk.filter((e) => minutesOfDay(e.startTime) <= now).length;
  const started = classes.some((e) => minutesOfDay(e.startTime) <= now);
  // No classes: the sheet already says so, so the band adds nothing.
  const bandLine = !painted || classes.length === 0
    ? undefined
    : [
        openNow > 0
          ? `${openNow} ${openNow === 1 ? 'register' : 'registers'} open`
          : started
            ? 'Registers up to date'
            : `${classes.length} ${classes.length === 1 ? 'class' : 'classes'} today`,
        nextClass ? `next class ${nextClass.startTime}` : 'all classes done',
      ].join(' · ');

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

  // DO NOW (user, 19 Oct 2026: "more direct actions in homepage itself"):
  // what is waiting on the teacher today, each finished in one tap. The class
  // the sheet's own button already takes is not repeated here.
  const sheetClassId =
    entry?.kind === 'CLASS' && !entry.register?.taken
      ? entry.slot?.classSectionId
      : !entry && !nextEntry
        ? needsInk[0]?.slot?.classSectionId
        : undefined;
  const lastTaught = [...classes].reverse().find((e) => e.slot && minutesOfDay(e.endTime) <= now);
  const doNow: DoNowItem[] = [
    ...needsInk
      .filter((e) => e.slot && e.slot.classSectionId !== sheetClassId && minutesOfDay(e.startTime) <= now)
      .map((e) => ({
        key: `register-${e.slot!.classSectionId}-${e.periodId}`,
        icon: 'take',
        tone: 'amber' as const,
        title: `Take ${e.slot!.className} register`,
        line: `${e.slot!.subjectName} · ${e.startTime}–${e.endTime}${minutesOfDay(e.endTime) <= now ? ' · over' : ''}`,
        verb: 'Take',
        onPress: () => goToAttendance(e.slot!.classSectionId),
      })),
    ...(newConcerns > 0
      ? [{
          key: 'concerns', icon: 'concern', tone: 'amber' as const,
          title: `${newConcerns} new ${newConcerns === 1 ? 'concern' : 'concerns'} from families`,
          line: 'Complaint Box', verb: 'Open',
          onPress: () => router.push('/(staff)/(tabs)/home/concerns'),
        }]
      : []),
    ...(unreadMsgs > 0
      ? [{
          key: 'messages', icon: 'messages',
          title: `${unreadMsgs} unread ${unreadMsgs === 1 ? 'message' : 'messages'}`,
          line: 'Families and staff', verb: 'Reply',
          onPress: () => router.push('/(staff)/(tabs)/home/messages'),
        }]
      : []),
    ...(syllabusOn && lastTaught?.slot
      ? [{
          key: 'syllabus', icon: 'syllabus',
          title: `Mark where ${lastTaught.slot.className} reached`,
          line: `${lastTaught.slot.subjectName} · taught today`, verb: 'Update',
          onPress: () => router.push(`/(staff)/(tabs)/home/syllabus/${encodeURIComponent(lastTaught.slot!.classSectionId)}?subjectId=${encodeURIComponent(lastTaught.slot!.subjectId)}`),
        }]
      : []),
  ];

  return (
    <Screen band onRefresh={refresh} refreshing={refreshing}>
      {/* Direction C: the greeting sits on the band; the sheet (NowCard) overlaps it. */}
      <BandGreeting
        eyebrow={fmtLongDay(new Date())}
        title={s?.displayName ?? 'Today'}
        right={<NotificationBell group="(staff)" onBand />}
        line={error ? undefined : bandLine}
      />

      {error && <ErrorState error={error} onRetry={reload} />}

      {/* The caption above still carries the sentence, because it IS a sentence
          — it becomes "3 classes today · 1 taken · 2 pending", not a list. What
          was missing is the shape of everything below it: the hero, then the
          day. Home is the screen a teacher opens on a corridor connection, so
          it is the one where an empty page for two seconds reads as broken. */}
      {!painted && !error && <LoadingRows label="Loading your day…" rows={4} />}

      {painted && day !== null && !error && entries.length === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            No timetable has been set up for you yet — ask your school admin.
          </Text>
        </Card>
      )}

      {painted && day !== null && !error && entries.length > 0 && (
        <>
          {/* Pitch №6: the period's notes and to-dos live ON the hero as the
              kit row, and open as a bottom sheet — not as two cards of their
              own pushing the day's asks below the fold. */}
          <NowCard
            entry={entry}
            elapsed={elapsed}
            total={total}
            nextEntry={nextEntry}
            onTakeAttendance={goToAttendance}
            onOpenClass={goToClass}
            summary={{ classesTaught: classes.length, studentsMarked, pendingRegisters: pending, firstPendingClassId: needsInk[0]?.slot?.classSectionId }}
            notesCount={periodCounts.notes}
            todosLeft={periodCounts.todosLeft}
            onOpenNotes={liveSlot ? () => setSheet('notes') : undefined}
            onOpenTodos={liveSlot ? () => setSheet('todos') : undefined}
            figuresOnBand={!error}
          />

          {liveSlot && (
            <PeriodSheet
              open={sheet !== null}
              focus={sheet ?? 'notes'}
              classSectionId={liveSlot.classSectionId}
              date={date}
              subjectId={liveSlot.subjectId}
              className={liveSlot.className}
              subjectName={liveSlot.subjectName}
              onClose={() => {
                setSheet(null);
                refreshPeriodCounts();
              }}
            />
          )}

          {/* QUICK ACTIONS (user, 19 Oct 2026): the day's four jobs, under the sheet. */}
          <QuickActions
            actions={[
              {
                label: 'Take register', icon: 'take', tone: 'amber', testID: 'hero-act-register', badge: needsInk.length,
                onPress: () => {
                  const open = needsInk.find((e) => minutesOfDay(e.startTime) <= now) ?? needsInk[0];
                  if (open?.slot) goToAttendance(open.slot.classSectionId);
                  else router.push('/(staff)/(tabs)/attendance');
                },
              },
              { label: 'Set homework', icon: 'assignments', testID: 'hero-act-homework', onPress: () => router.push('/(staff)/(tabs)/home/assignments') },
              { label: 'Post notice', icon: 'notices', testID: 'hero-act-notice', onPress: () => router.push('/(staff)/(tabs)/home/post') },
              { label: 'Write diary', icon: 'diary', testID: 'hero-act-diary', onPress: () => router.push('/(staff)/(tabs)/home/diary') },
            ]}
          />

          <DoNow items={doNow} />

          {/* THE MENU — one card instead of "Needs you today" + "Go to" (user,
              9 Oct 2026: "make that menu together"). Register, Homework,
              Notice and Test are the hero's quick actions (the register count
              rides there as a badge), so they are not drawn twice; every
              other door is here, badged ones first. */}
          <HomeMenu
            groups={[
              {
                title: 'In class',
                tools: [
                  { label: 'Test', icon: 'results', testID: 'hero-act-test', route: '/(staff)/(tabs)/home/tests' },
                  // Where each class has reached — only where the owner switched the tracker on.
                  ...(syllabusOn ? [{ label: 'Syllabus', icon: 'syllabus', route: '/(staff)/(tabs)/home/syllabus', ...(syllabusPct !== null ? { arc: syllabusPct } : {}) }] : []),
                  { label: 'Notes', icon: 'notes', route: '/(staff)/(tabs)/home/notes' },
                ],
              },
              {
                title: 'Messages',
                tools: [
                  { label: 'Messages', icon: 'messages', route: '/(staff)/(tabs)/home/messages', badge: unreadMsgs },
                  // Concerns the class teacher's families raised. Free, so always
                  // drawn — it was on no screen before 2026-10-07 (nav-reachability).
                  { label: 'Complaint Box', icon: 'concern', tone: 'amber' as const, route: '/(staff)/(tabs)/home/concerns', badge: newConcerns },
                ],
              },
              {
                title: 'For you',
                tools: [
                  { label: 'Requests', icon: 'requests', route: '/(staff)/(tabs)/home/requests' },
                  { label: 'Holidays', icon: 'holidays', tone: 'green' as const, route: '/(staff)/(tabs)/home/holidays', date: String(new Date().getDate()) },
                  // Pay slips, only where the school runs pay on Sckools.
                  ...(hasFeature(s, 'SALARY') ? [{ label: 'My pay', icon: 'fees', tone: 'green' as const, route: '/(staff)/(tabs)/home/salary' }] : []),
                  // The teacher's own shelf — only for a school with the library on.
                  ...(hasFeature(s, 'LIBRARY') ? [{ label: 'Library', icon: 'library', route: '/(staff)/(tabs)/home/library' }] : []),
                ],
              },
            ]}
          />

          <DayTimeline entries={entries} currentIndex={index} onTakeAttendance={goToAttendance} />
        </>
      )}
    </Screen>
  );
}

