'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { SyllabusChapterList, SyllabusOverview } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { HubPage } from '@/components/ui/hub';
import { QueryError } from '@/components/ui/query-state';
import { ChapterEditor } from '@/components/syllabus/chapter-editor';
import { NotInPlan, isPlanRefusal } from '@/components/syllabus/shared';
import { useChapterMutations } from '@/components/syllabus/chapter-mutations';

/**
 * Chapter lists: one per class + subject, shared by every section of the
 * class and by next year's sections too. The office keeps them here; a
 * subject teacher can also add from their own track page.
 */
export default function SyllabusChaptersPage() {
  return (
    <Suspense fallback={<p className="sk-state">Opening…</p>}>
      <ChaptersInner />
    </Suspense>
  );
}

function ChaptersInner() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const params = useSearchParams();
  const [gradeId, setGradeId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  useEffect(() => {
    const g = params.get('gradeId');
    const s = params.get('subjectId');
    if (g) setGradeId(g);
    if (s) setSubjectId(s);
  }, [params]);

  const overview = useQuery({ queryKey: ['syllabus-overview', host], enabled: !!host, retry: false, queryFn: () => api.get<SyllabusOverview>('/manage/syllabus/overview') });
  const list = useQuery({
    queryKey: ['syllabus-chapters', host, gradeId, subjectId],
    enabled: !!host && !!gradeId && !!subjectId,
    queryFn: () => api.get<SyllabusChapterList>(`/manage/syllabus/chapters?gradeId=${gradeId}&subjectId=${subjectId}`),
  });
  const m = useChapterMutations(api, [['syllabus-chapters'], ['syllabus-overview'], ['syllabus-track']]);

  if (isPlanRefusal(overview.error)) return <NotInPlan />;
  const d = overview.data;

  return (
    <HubPage
      title="Chapter lists"
      subtitle="One list per class and subject. Every section of the class, this year and next, teaches from it."
      action={<Link className="sk-btn sk-press" href="/app/syllabus">Back to the year</Link>}
    >
      {overview.isError && <QueryError error={overview.error} onRetry={overview.refetch} />}
      {overview.isLoading && <p className="sk-state">Opening…</p>}
      {d && (
        <section className="sk-card" aria-label="Choose a class and subject">
          <div className="sk-card-b">
            <div className="sk-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
              <label className="sk-sronly" htmlFor="syl-c-grade">Class</label>
              <select id="syl-c-grade" className="sk-input sk-toolbar-pick" value={gradeId} onChange={(e) => setGradeId(e.target.value)} data-testid="syl-c-grade">
                <option value="">Choose a class</option>
                {d.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <label className="sk-sronly" htmlFor="syl-c-subject">Subject</label>
              <select id="syl-c-subject" className="sk-input sk-toolbar-pick" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} data-testid="syl-c-subject">
                <option value="">Choose a subject</option>
                {d.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {d.grades.length === 0 && <p className="sk-state" style={{ margin: '10px 0 0' }}>No classes in the current session yet.</p>}
            {d.grades.length > 0 && d.subjects.length === 0 && <p className="sk-state" style={{ margin: '10px 0 0' }}>No subjects yet. Add them under Settings → General first.</p>}
          </div>
        </section>
      )}
      {d && (!gradeId || !subjectId) && <p className="sk-state" data-testid="syl-c-choose">Pick a class and a subject above to see or build its chapter list.</p>}
      {gradeId && subjectId && (
        <section className="sk-card" aria-label="Chapters">
          <div className="sk-card-h"><h3>{list.data ? `${list.data.gradeName} · ${list.data.subjectName}` : 'Chapters'}</h3></div>
          <div className="sk-card-b">
            {list.isLoading && <p className="sk-state" style={{ margin: 0 }}>Opening…</p>}
            {list.isError && <QueryError error={list.error} onRetry={list.refetch} />}
            {list.data && (
              <ChapterEditor
                list={list.data}
                busy={m.busy}
                onAdd={(title, parentId) => m.add.mutate({ gradeId, subjectId, title, parentId })}
                onRename={(id, title) => m.rename.mutate({ id, title })}
                onRetire={(id) => m.retire.mutate(id)}
              />
            )}
          </div>
        </section>
      )}
    </HubPage>
  );
}
