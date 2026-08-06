import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { TeacherDay, TeacherDayEntry } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { session } from '@/lib/session';
import { todayISO } from '@/lib/attendance';
import { currentEntry, minutesOfDay } from '@/lib/teacher-day';
import { NowCard } from '@/components/NowCard';
import { DayTimeline } from '@/components/DayTimeline';
import { ClassNotesPanel } from '@/components/ClassNotesPanel';
import { Card, Page, PageHeader, Screen } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { salutation } from '@/lib/greeting';

/** Minutes past midnight on the device's own clock, for `currentEntry`. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

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
}: {
  icon: string;
  title: string;
  note: string;
  right: ReactNode;
  onPress: () => void;
  testID?: string;
  first?: boolean;
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
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tokens.color.amber50,
        }}
      >
        <Text style={{ fontSize: 14 }}>{icon}</Text>
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
  const date = todayISO();

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
  const now = nowMinutes();
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

  function isLive(e: TeacherDayEntry): boolean {
    return entry?.periodId === e.periodId;
  }

  return (
    <Screen>
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
                  icon="📋"
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

          <DayTimeline entries={entries} currentIndex={index} onTakeAttendance={goToAttendance} />
        </>
      )}
    </Screen>
  );
}
