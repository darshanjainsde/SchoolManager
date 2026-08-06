import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
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
import { Card, Page, PageHeader, Screen } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { NotificationBell } from '@/components/NotificationBell';
import { HomeToolGrid } from '@/components/HomeToolGrid';
import { Icon, isIconName } from '@/components/icons';
import { SettingsButton } from '@/components/SettingsButton';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { salutation } from '@/lib/greeting';

/**
 * `.needrow` — one line of the "Needs your ink" queue: an amber icon tile, the
 * thing that is outstanding, what it will cost to do it, and how loudly it is
 * asking (a live register says "now" in amber; everything else says "›").
 *
 * The queue exists because a teacher's day has exactly one kind of debt —
 * something that should have been written down and hasn't been — and a list of
 * those is more useful than any dashboard. Every row here is a register that
 * is still open; nothing is invented, and the row disappears the moment the
 * register is taken.
 */
function NeedRow({
  icon,
  title,
  note,
  right,
  onPress,
  testID,
  first,
  live,
}: {
  icon: string;
  title: string;
  note: string;
  right: ReactNode;
  onPress: () => void;
  testID?: string;
  first?: boolean;
  /** The period running right now. At most one row per screen sets this. */
  live?: boolean;
}) {
  const tokens = useTokens();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderTopWidth: first || live ? 0 : 1,
        borderTopColor: tokens.color.line,
        // The single filled thing on Home. A wash rather than a solid fill:
        // the row still has to read as a row of text, not as a button.
        backgroundColor: live ? tokens.color.amber50 : undefined,
        borderRadius: live ? 12 : 0,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: live ? tokens.color.amber : tokens.color.amber50,
        }}
      >
        {isIconName(icon) && (
          <Icon name={icon} size={16} color={live ? tokens.color.ink : tokens.color.late} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{title}</Text>
        <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }} numberOfLines={1}>
          {note}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

export default function Today() {
  const tokens = useTokens();
  const [name, setName] = useState<string | null>(null);
  const [day, setDay] = useState<TeacherDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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
    router.push(`/(staff)/class/${classSectionId}?${params.toString()}`);
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
            style={{ fontFamily: font.serif, fontSize: 26, lineHeight: 31, color: tokens.color.ink }}
          >
            {name ?? 'Today'}
          </Text>
        </View>
        <NotificationBell group="(staff)" />
        <SettingsButton group="(staff)" />
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

          {needsInk.length > 0 && (
            <Page>
              <PageHeader title="Needs your ink" />
              {needsInk.map((e, i) => (
                <NeedRow
                  key={e.periodId}
                  testID={`need-take-${e.slot!.classSectionId}`}
                  first={i === 0}
                  live={isLive(e)}
                  icon="take"
                  title={`${e.slot!.className} register — not taken`}
                  note={`${e.label} · ${e.startTime}–${e.endTime} · ${e.register?.total ?? 0} students`}
                  right={
                    isLive(e) ? (
                      <Text style={{ color: tokens.color.late, fontWeight: '800', fontSize: 11 }}>now</Text>
                    ) : (
                      <Text style={{ color: tokens.color.sub, fontSize: 13 }}>›</Text>
                    )
                  }
                  onPress={() => goToAttendance(e.slot!.classSectionId)}
                />
              ))}
            </Page>
          )}

          {/* GO TO — navigation, and nothing else. No tile here is ever filled:
              the one lit thing on this screen is the live ROW above, which is
              what makes amber mean "act now" rather than "this exists".
              Registers is deliberately absent — it is a task, and tasks live in
              the queue where they carry a class name and a time. */}
          <Text style={eyebrow(tokens)}>Go to</Text>
          <HomeToolGrid
            testID="grid-goto"
            tools={[
              { label: 'Messages', icon: 'messages', route: '/(staff)/messages', tone: 'amber' },
              { label: 'Diary', icon: 'diary', route: '/(staff)/diary' },
              { label: 'Assignments', icon: 'assignments', route: '/(staff)/assignments' },
              { label: 'Notes', icon: 'notes', route: '/(staff)/notes' },
              { label: 'Tests & Results', icon: 'results', route: '/(staff)/tests' },
              { label: 'Requests', icon: 'requests', route: '/(staff)/requests', tone: 'amber' },
              { label: 'Announce', icon: 'notices', route: '/(staff)/post', tone: 'amber' },
              { label: 'Holidays', icon: 'holidays', route: '/(staff)/holidays', tone: 'green' },
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
