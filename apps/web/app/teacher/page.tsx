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

/**
 * The pitch's "Needs your ink" queue: every class of today's that has started
 * and still has no register. Derived entirely from the my-day payload the page
 * already has — no extra request — because the whole argument for the queue is
 * that the next thing to do should be visible without hunting for it, and a
 * queue that costs a round trip arrives after the teacher has already gone
 * looking.
 *
 * A class that has NOT started yet is excluded on purpose: it is not
 * outstanding work, it is the timetable, and the rail below already shows it.
 */
function outstandingRegisters(entries: TeacherDay['entries'], now: number) {
  return entries.filter(
    (e) => e.kind === 'CLASS' && !!e.slot && !e.register?.taken && minutesOfDay(e.startTime) <= now,
  );
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
  const needsInk = outstandingRegisters(entries, now);

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

          {/* THE QUEUE. One row per register the day is still waiting on,
              each an amber-tiled `needrow` — amber because everything in this
              list is by definition outstanding. The card only exists when
              there is something in it: an empty "Needs your ink" heading
              would read as a broken widget rather than as a clear desk. */}
          {needsInk.length > 0 && (
            <div className="sk-card">
              <div className="sk-card-h">
                <h3>Needs your ink</h3>
              </div>
              <div className="sk-card-b">
                {needsInk.map((e) => (
                  <button
                    key={e.periodId}
                    type="button"
                    className="sk-needrow sk-press"
                    onClick={() => e.slot && goToAttendance(e.slot.classSectionId)}
                  >
                    <span className="ni" aria-hidden="true">
                      📋
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="nt" style={{ display: 'block' }}>
                        {e.slot?.className} · {e.slot?.subjectName} — register not taken
                      </span>
                      <span className="nn" style={{ display: 'block' }}>
                        {e.startTime}–{e.endTime}
                        {e.register ? ` · ${e.register.total} students` : ''}
                      </span>
                    </span>
                    {/* The live period's row is the one to do first, so it
                        says so rather than looking like the others. */}
                    <span className="sk-pill" data-tone={e === entry ? 'warn' : 'info'}>
                      {e === entry ? 'now' : 'due'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {entry?.kind === 'CLASS' && entry.slot && (
            <ClassNotes
              classSectionId={entry.slot.classSectionId}
              date={date}
              subjectId={entry.slot.subjectId}
              subjectName={entry.slot.subjectName}
            />
          )}

          <DayTimeline entries={entries} currentIndex={index} onTakeAttendance={goToAttendance} />
        </div>
      )}
    </>
  );
}
