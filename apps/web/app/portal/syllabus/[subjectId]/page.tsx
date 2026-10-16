'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StudentSyllabusLeaf, StudentSyllabusSubjectDetail } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { Figure, Figures } from '@/components/ui/kit';
import { QueryError } from '@/components/ui/query-state';
import { STATUS_LABEL, STATUS_TONE } from '@/components/syllabus/labels';
import { REVISED_COLOR, RingLegend, StudyRings, TAUGHT_COLOR } from '@/components/syllabus/rings';
import { NotInPlan, isPlanRefusal } from '@/components/syllabus/shared';

type Filter = 'ALL' | 'REVISE' | 'DONE';

/**
 * One subject for a child: the chapters in order, what the teacher said
 * about each, and my own note — which nobody else reads. "To revise" lists
 * what has been taught and has no note yet.
 */
export default function PortalSubjectPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const key = ['me-syllabus-subject', host, subjectId];
  const q = useQuery({ queryKey: key, enabled: !!host, retry: false, queryFn: () => api.get<StudentSyllabusSubjectDetail>(`/me/syllabus/subjects/${subjectId}`) });
  const save = useMutation({
    mutationFn: ({ chapterId, body }: { chapterId: string; body: string }) => api.put<{ chapterId: string; myNote: string | null }>(`/me/syllabus/notes/${chapterId}`, { body }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['me-syllabus'] });
      toast.success(r.myNote ? 'Note saved.' : 'Note removed.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isPlanRefusal(q.error)) return <NotInPlan />;
  if (q.error instanceof ApiError && q.error.status === 404) return <p className="sk-state err">That subject is not on your list.</p>;
  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-10" />;
  if (q.isLoading || !q.data) return <p className="sk-state">Opening…</p>;
  const { subject: s, chapters } = q.data;
  const show = (l: StudentSyllabusLeaf) => filter === 'ALL' || (filter === 'DONE' ? l.status === 'DONE' : l.status === 'DONE' && !l.myNote);
  const toRevise = s.done - s.revised > 0 ? s.done - s.revised : 0;

  return (
    <div className="flex flex-col gap-6">
      <div><Link className="sk-btn sk-press" href="/portal/syllabus">← All subjects</Link></div>
      <header className="sk-pagehead">
        <h1>{s.subjectName}</h1>
        <p>{s.teacher ?? 'Teacher not on the timetable'}{s.now ? ` · Now: ${s.now.title}` : ''}</p>
      </header>

      <div className="sk-card">
        <div className="sk-card-b" style={{ display: 'grid', gap: 14 }}>
          <div className="sk-syl-hero">
            <StudyRings pct={s.pct} revisedPct={s.revisedPct} size={112} stroke={11} testId="syl-study-rings" />
            <RingLegend outer={{ pct: s.pct, color: TAUGHT_COLOR, label: 'Taught' }} inner={{ pct: s.revisedPct, color: REVISED_COLOR, label: 'Revised by me' }} />
            <div className="txt">
              <h2>{toRevise ? `${toRevise} ${toRevise === 1 ? 'topic' : 'topics'} to revise` : s.done ? 'Everything taught is revised' : 'Nothing taught yet'}</h2>
              <p>A topic counts as revised once you write a note on it. Your notes are yours alone.</p>
            </div>
          </div>
          <Figures count={3}>
            <Figure value={`${s.done} / ${s.leaves}`} label="Taught" />
            <Figure value={s.revised} label="Revised by me" />
            <Figure value={toRevise} label="To revise" />
          </Figures>
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h"><h3>Chapters</h3></div>
        <div className="sk-card-b">
          {/* The filter sits under the title, full width: squeezed beside the h3 it wrapped to three lines. */}
          <div className="sk-seg" role="group" aria-label="Show" style={{ maxWidth: 420, marginBottom: 12 }}>
            {([['ALL', 'All'], ['REVISE', `To revise${toRevise ? ` · ${toRevise}` : ''}`], ['DONE', 'Taught']] as [Filter, string][]).map(([f, label]) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`syl-filter-${f}`} style={{ whiteSpace: 'nowrap', paddingInline: 6 }}>{label}</button>
            ))}
          </div>
          {chapters.length === 0 && <p className="sk-state" style={{ margin: 0 }}>No chapters yet. Your teacher adds them, and this fills in.</p>}
          {chapters.map((ch, i) => {
            const leaves = ch.children.length ? ch.children : [ch];
            const visible = leaves.filter(show);
            if (!visible.length) return null;
            return (
              <section key={ch.id} className="sk-syl-chapter" aria-label={ch.title} data-testid={`syl-ch-${ch.id}`}>
                <div className="head">
                  <div className="ttl">{i + 1}. {ch.title}{ch.children.length > 0 && <small>{ch.children.filter((c) => c.status === 'DONE').length} of {ch.children.length} sub-topics taught</small>}</div>
                  <span className="sk-pill" data-tone={STATUS_TONE[ch.status]}>{STATUS_LABEL[ch.status]}</span>
                </div>
                {ch.children.length > 0 && ch.teacherNote && <blockquote className="sk-syl-quote"><b>Teacher&rsquo;s note</b>{ch.teacherNote}</blockquote>}
                {visible.map((l) => (
                  <div key={l.id} className={`sk-syl-leaf${ch.children.length ? ' sub' : ''}`} data-testid={`syl-leaf-${l.id}`}>
                    {ch.children.length > 0 && (
                      <div className="head">
                        <div className="ttl" style={{ fontWeight: 600, fontSize: 13.5 }}>{l.title}{s.now?.chapterId === l.id && <small>Where the class is now</small>}</div>
                        <span className="sk-pill" data-tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</span>
                      </div>
                    )}
                    {l.teacherNote && <blockquote className="sk-syl-quote"><b>Teacher&rsquo;s note</b>{l.teacherNote}</blockquote>}
                    <MyNote leaf={l} busy={save.isPending} onSave={(body) => save.mutate({ chapterId: l.id, body })} />
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MyNote({ leaf, busy, onSave }: { leaf: StudentSyllabusLeaf; busy: boolean; onSave: (body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(leaf.myNote ?? '');
  const id = `syl-mynote-${leaf.id}`;
  if (!open) {
    return (
      <div className="sk-syl-note">
        {leaf.myNote ? <blockquote className="sk-syl-quote" style={{ borderLeft: `3px solid ${REVISED_COLOR}` }}><b>My note</b>{leaf.myNote}</blockquote> : null}
        <div className="row">
          <button type="button" className="sk-btn sk-press" data-size="sm" data-variant={!leaf.myNote && leaf.status === 'DONE' ? 'primary' : undefined} onClick={() => { setDraft(leaf.myNote ?? ''); setOpen(true); }} data-testid={`${id}-edit`}>
            {leaf.myNote ? 'Edit my note' : leaf.status === 'DONE' ? 'Revise: write a note' : 'Write a note'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="sk-syl-note">
      <label className="sk-sronly" htmlFor={id}>My note on {leaf.title}</label>
      <textarea id={id} value={draft} maxLength={2000} placeholder="What to remember from this topic" onChange={(e) => setDraft(e.target.value)} data-testid={id} />
      <div className="row">
        <button type="button" className="sk-btn sk-press" data-variant="primary" data-size="sm" disabled={busy} onClick={() => { onSave(draft.trim()); setOpen(false); }} data-testid={`${id}-save`}>Save</button>
        {leaf.myNote && <button type="button" className="sk-btn sk-press" data-size="sm" data-tone="bad" disabled={busy} onClick={() => { onSave(''); setOpen(false); }} data-testid={`${id}-clear`}>Remove note</button>}
        <button type="button" className="sk-btn sk-press" data-size="sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
