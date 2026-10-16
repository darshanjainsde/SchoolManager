'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SyllabusChapterList, SyllabusTrack } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { Figure, Figures, Note } from '@/components/ui/kit';
import { QueryError } from '@/components/ui/query-state';
import { ChapterList, type MarkBody } from '@/components/syllabus/chapter-list';
import { ChapterEditor } from '@/components/syllabus/chapter-editor';
import { gapLine, sinceLine } from '@/components/syllabus/labels';
import { NotInPlan, TrackHero, isPlanRefusal } from '@/components/syllabus/shared';
import { useChapterMutations } from '@/components/syllabus/chapter-mutations';

/**
 * One track: the rings, then the chapters. Mark a leaf with three buttons,
 * or press "Reached here" and everything before it is done. The note under
 * a chapter is for the class and the family app shows it. The chapter list
 * itself is edited at the bottom and is shared by every section of the class.
 */
export default function TeacherTrackPage() {
  const { classSectionId, subjectId } = useParams<{ classSectionId: string; subjectId: string }>();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const key = ['syllabus-track', host, classSectionId, subjectId];
  const q = useQuery({ queryKey: key, enabled: !!host, retry: false, queryFn: () => api.get<SyllabusTrack>(`/manage/syllabus/tracks/${classSectionId}/${subjectId}`) });
  const chapters = useQuery({
    queryKey: ['syllabus-chapters', host, q.data?.summary.gradeId, subjectId],
    enabled: !!host && !!q.data?.canEdit,
    queryFn: () => api.get<SyllabusChapterList>(`/manage/syllabus/chapters?gradeId=${q.data!.summary.gradeId}&subjectId=${subjectId}`),
  });

  const settle = (t: SyllabusTrack) => {
    qc.setQueryData(key, t);
    void qc.invalidateQueries({ queryKey: ['syllabus-mine'] });
  };
  const mark = useMutation({
    mutationFn: ({ chapterId, body }: { chapterId: string; body: MarkBody }) => api.put<SyllabusTrack>(`/manage/syllabus/tracks/${classSectionId}/${subjectId}/progress/${chapterId}`, body),
    onSuccess: (t, v) => { settle(t); toast.success(v.body.note !== undefined ? 'Note saved.' : 'Marked.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reach = useMutation({
    mutationFn: (chapterId: string) => api.post<SyllabusTrack>(`/manage/syllabus/tracks/${classSectionId}/${subjectId}/reach/${chapterId}`, {}),
    onSuccess: (t) => { settle(t); toast.success('Everything before it is done.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const editor = useChapterMutations(api, [['syllabus-chapters'], ['syllabus-track'], ['syllabus-mine']]);

  if (isPlanRefusal(q.error)) return <NotInPlan />;
  if (q.error instanceof ApiError && q.error.status === 404) return <p className="sk-state err">That class or subject does not exist any more.</p>;
  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-10" />;
  if (q.isLoading || !q.data) return <p className="sk-state">Opening the track…</p>;
  const t = q.data;
  const s = t.summary;
  const busy = mark.isPending || reach.isPending;

  return (
    <div className="flex flex-col gap-6">
      <div><Link className="sk-btn sk-press" href="/teacher/syllabus">← All classes</Link></div>
      <header className="sk-pagehead">
        <h1>{s.className} · {s.subjectName}</h1>
        <p>{t.year.name} · {s.teacher ? `${s.teacher.name}` : 'No teacher on the timetable'}{s.isClassTeacher ? ' · you are the class teacher' : ''}</p>
      </header>

      <div className="sk-card">
        <div className="sk-card-b" style={{ display: 'grid', gap: 14 }}>
          <TrackHero t={s} title={gapLine(s)} line={`Last update ${sinceLine(s.lastUpdatedAt).toLowerCase()}`} />
          <Figures count={3}>
            <Figure value={`${s.done} / ${s.leaves}`} label="Topics done" />
            <Figure value={`${s.expectedPct}%`} label="Expected by today" />
            <Figure value={s.leaves - s.done} label="Topics left" />
          </Figures>
        </div>
      </div>

      {!t.canEdit && <Note tone="warn">You are covering this class today, so you can read the syllabus but not mark it. The regular teacher&rsquo;s log stays theirs.</Note>}

      <div className="sk-card">
        <div className="sk-card-h"><h3>Chapters</h3></div>
        <div className="sk-card-b">
          <ChapterList track={t} busy={busy} onMark={t.canEdit ? (chapterId, body) => mark.mutate({ chapterId, body }) : undefined} onReach={t.canEdit ? (chapterId) => reach.mutate(chapterId) : undefined} />
        </div>
      </div>

      {t.canEdit && (
        <div className="sk-card">
          <div className="sk-card-h"><h3>Chapter list for {s.gradeName} {s.subjectName}</h3></div>
          <div className="sk-card-b">
            <p className="sk-muted" style={{ fontSize: 12.5, marginTop: 0 }}>Shared by every section of {s.gradeName}, this year and next. Removing keeps what was already logged.</p>
            {chapters.isLoading && <p className="sk-state" style={{ margin: 0 }}>Opening…</p>}
            {chapters.data && (
              <ChapterEditor
                list={chapters.data}
                busy={editor.busy}
                onAdd={(title, parentId) => editor.add.mutate({ gradeId: s.gradeId, subjectId, title, parentId })}
                onRename={(id, title) => editor.rename.mutate({ id, title })}
                onRetire={(id) => editor.retire.mutate(id)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
