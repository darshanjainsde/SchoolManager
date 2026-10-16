'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { SyllabusTrackSummary, SyllabusYear } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { PACE_LABEL, PACE_TONE } from '@/components/syllabus/labels';
import { EXPECTED_COLOR, PaceRings, RingLegend, TAUGHT_COLOR } from '@/components/syllabus/rings';
import { NotInPlan, isPlanRefusal } from '@/components/syllabus/shared';

/**
 * THE SYLLABUS, the teacher's side: one card per class and subject they
 * log, two rings on each (taught vs expected by today), and where the class
 * is now. A card opens the track.
 */
export default function TeacherSyllabusPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({ queryKey: ['syllabus-mine', host], enabled: !!host, retry: false, queryFn: () => api.get<{ year: SyllabusYear | null; tracks: SyllabusTrackSummary[] }>('/manage/syllabus/mine') });

  if (isPlanRefusal(q.error)) return <NotInPlan />;
  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-10" />;
  if (q.isLoading || !q.data) return <p className="sk-state">Opening your classes…</p>;
  const { year, tracks } = q.data;
  const measured = tracks.filter((t) => t.pace !== 'none');
  const unmeasured = tracks.length - measured.length;
  const behind = measured.filter((t) => t.pace === 'bad' || t.pace === 'warn').length;

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Syllabus</h1>
        <p>
          {year ? `${year.name} · ${year.expectedPct}% of working days gone` : 'No current session yet'}
          {measured.length ? ` · ${behind ? `${behind} of ${measured.length} behind` : 'every class on pace'}` : ''}
          {unmeasured ? ` · ${unmeasured} without chapters` : ''}
        </p>
      </header>
      {!year && <p className="sk-state" data-testid="syl-no-year">The office has not set the current session yet. Ask them, and your classes appear here.</p>}
      {year && tracks.length === 0 && (
        <p className="sk-state" data-testid="syl-no-tracks">
          No classes on your timetable yet. Once the office puts you on a class&rsquo;s timetable, or makes you its class teacher, its syllabus appears here.
        </p>
      )}
      {tracks.length > 0 && (
        <div className="sk-syl-cards" data-testid="syl-tracks">
          {tracks.map((t) => (
            <Link key={`${t.classSectionId}:${t.subjectId}`} className="sk-syl-card" href={`/teacher/syllabus/${t.classSectionId}/${t.subjectId}`} data-testid={`syl-track-${t.classSectionId}-${t.subjectId}`}>
              <PaceRings pct={t.pct} expectedPct={t.expectedPct} size={72} stroke={8} />
              <div className="body">
                <span className="nm">{t.className} · {t.subjectName}</span>
                <span className="meta">
                  <span className="sk-pill" data-tone={PACE_TONE[t.pace]}>{PACE_LABEL[t.pace]}</span>
                  {t.isClassTeacher ? ' · Class teacher' : ''}
                  {t.leaves ? ` · ${t.done} of ${t.leaves} done` : ''}
                </span>
                <span className="now">{t.now ? `Now: ${t.now.title}` : t.leaves ? 'Every chapter done' : 'No chapters yet — add them'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {tracks.length > 0 && (
        <div className="sk-card">
          <div className="sk-card-b">
            <RingLegend outer={{ pct: measured.length ? Math.round(measured.reduce((s, t) => s + t.pct, 0) / measured.length) : 0, color: TAUGHT_COLOR, label: 'Taught (average)' }} inner={{ pct: year?.expectedPct ?? 0, color: EXPECTED_COLOR, label: 'Expected by today' }} />
          </div>
        </div>
      )}
    </div>
  );
}
