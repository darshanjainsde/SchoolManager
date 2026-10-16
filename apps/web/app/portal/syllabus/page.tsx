'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { StudentSyllabusHome } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { REVISED_COLOR, RingLegend, StudyRings, TAUGHT_COLOR } from '@/components/syllabus/rings';
import { NotInPlan, isPlanRefusal } from '@/components/syllabus/shared';

/**
 * THE SYLLABUS, the child's side: one card per subject, two rings on each —
 * what the class has been taught, and what I have revised (written a note
 * on). The blue ring being smaller than the green one is the whole message.
 */
export default function PortalSyllabusPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({ queryKey: ['me-syllabus', host], enabled: !!host, retry: false, queryFn: () => api.get<StudentSyllabusHome>('/me/syllabus') });

  if (isPlanRefusal(q.error)) return <NotInPlan />;
  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-10" />;
  if (q.isLoading || !q.data) return <p className="sk-state">Opening your subjects…</p>;
  const d = q.data;
  const toRevise = d.subjects.reduce((s, x) => s + (x.done - x.revised > 0 ? x.done - x.revised : 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Syllabus</h1>
        <p>{d.className ? `${d.className}` : 'No class yet'}{d.year ? ` · ${d.year.name}` : ''}{d.subjects.length ? ` · ${toRevise ? `${toRevise} taught ${toRevise === 1 ? 'topic' : 'topics'} to revise` : 'everything taught is revised'}` : ''}</p>
      </header>
      {!d.className && <p className="sk-state" data-testid="syl-no-class">You are not in a class yet. Once the office puts you in one, your subjects appear here.</p>}
      {d.className && d.subjects.length === 0 && <p className="sk-state" data-testid="syl-no-subjects">No chapters yet. Your teachers add them, and this fills in.</p>}
      {d.subjects.length > 0 && (
        <div className="sk-syl-cards" data-testid="syl-subjects">
          {d.subjects.map((s) => (
            <Link key={s.subjectId} className="sk-syl-card" href={`/portal/syllabus/${s.subjectId}`} data-testid={`syl-subject-${s.subjectId}`}>
              <StudyRings pct={s.pct} revisedPct={s.revisedPct} size={72} stroke={8} />
              <div className="body">
                <span className="nm">{s.subjectName}</span>
                <span className="meta">{s.teacher ?? 'Teacher not on the timetable'} · {s.done} of {s.leaves} taught · {s.revised} revised</span>
                <span className="now">{s.now ? `Now: ${s.now.title}` : s.leaves ? 'Every chapter done' : 'No chapters yet'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {d.subjects.length > 0 && (
        <div className="sk-card">
          <div className="sk-card-b">
            <RingLegend
              outer={{ pct: Math.round(d.subjects.reduce((a, s) => a + s.pct, 0) / d.subjects.length), color: TAUGHT_COLOR, label: 'Taught (average)' }}
              inner={{ pct: Math.round(d.subjects.reduce((a, s) => a + s.revisedPct, 0) / d.subjects.length), color: REVISED_COLOR, label: 'Revised by me (average)' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
