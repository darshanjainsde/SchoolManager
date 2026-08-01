import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { TeacherDay } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { session } from '@/lib/session';
import { todayISO } from '@/lib/attendance';
import { currentEntry, minutesOfDay } from '@/lib/teacher-day';
import { NowCard } from '@/components/NowCard';
import { DayTimeline } from '@/components/DayTimeline';
import { ClassNotesPanel } from '@/components/ClassNotesPanel';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/** Minutes past midnight on the device's own clock, for `currentEntry`. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
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

  function goToAttendance(classSectionId: string) {
    const className = entries.find((e) => e.slot?.classSectionId === classSectionId)?.slot?.className;
    const nameParam = className ? `?name=${encodeURIComponent(className)}` : '';
    router.push(`/(staff)/take/${classSectionId}${nameParam}`);
  }

  return (
    <Screen>
      <SectionTitle title={name ? `Good day, ${name}` : 'Today'} />
      <Card>
        <Text style={{ color: tokens.color.sub, fontSize: 12.5 }}>
          {day === null && !error
            ? 'Loading your day…'
            : `${classes.length} class${classes.length === 1 ? '' : 'es'} today · ${taken} taken · ${pending} pending`}
        </Text>
      </Card>

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

          <DayTimeline entries={entries} currentIndex={index} onTakeAttendance={goToAttendance} />
        </>
      )}
    </Screen>
  );
}
