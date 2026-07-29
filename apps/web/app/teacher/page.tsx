'use client';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { TeacherDay } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { currentEntry, minutesOfDay } from '@/lib/teacher-day';
import { NowCard } from '@/components/teacher/NowCard';
import { DayTimeline } from '@/components/teacher/DayTimeline';
import { ClassNotes } from '@/components/teacher/ClassNotes';

/** Today in the browser's own timezone — `toISOString()` would give the UTC day. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Minutes past midnight on the browser's own clock, for `currentEntry`. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export default function TeacherHomePage() {
  const host = useHost();
  const router = useRouter();
  const api = useApi({ audience: 'school', hostHeader: host });
  const date = todayIso();

  const day = useQuery({
    queryKey: ['t-my-day', date],
    enabled: !!host,
    queryFn: () => api.get<TeacherDay>(`/manage/timetable/my-day?date=${encodeURIComponent(date)}`),
  });

  const entries = day.data?.entries ?? [];
  const now = nowMinutes();
  const { index, entry, elapsed, total } = currentEntry(entries, now);
  // The first entry (chronologically) that hasn't started yet — this works
  // uniformly whether nothing is current (before school / a gap) or a class
  // or break is current right now (its own start is <= now, so it's skipped).
  const nextEntry = entries.find((e) => minutesOfDay(e.startTime) > now) ?? null;

  function goToAttendance(classSectionId: string) {
    router.push(`/teacher/attendance?classSectionId=${encodeURIComponent(classSectionId)}`);
  }

  return (
    <>
      <header className="sk-pagehead">
        <h1>Your day</h1>
        <p>What&apos;s happening now, and the rest of your timetable today.</p>
      </header>

      {day.isLoading && <p className="sk-state">Loading your day…</p>}
      {day.error && <p className="sk-state err">{(day.error as Error).message}</p>}

      {!day.isLoading && !day.error && entries.length === 0 && (
        <p className="sk-state">No timetable has been set up for you yet — ask your school admin.</p>
      )}

      {!day.isLoading && !day.error && entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <NowCard
            entry={entry}
            elapsed={elapsed}
            total={total}
            nextEntry={nextEntry}
            onTakeAttendance={goToAttendance}
          />

          {entry?.kind === 'CLASS' && entry.slot && <ClassNotes classSectionId={entry.slot.classSectionId} date={date} />}

          <DayTimeline entries={entries} currentIndex={index} onTakeAttendance={goToAttendance} />
        </div>
      )}
    </>
  );
}
