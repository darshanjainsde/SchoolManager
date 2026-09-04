'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { MAX_QUESTIONS, filterableKinds, type JobQuestionDraft } from '@/lib/jobs-admin';
import { JOB_TEMPLATES, type JobTemplate } from '@/lib/job-templates';
// The public listing's own labels — imported, not restated, so the preview
// cannot drift from the page it is previewing.
import { EMPLOYMENT_LABEL } from '@/lib/jobs-api';

interface Job {
  id: string;
  title: string;
  summary: string;
  description: string;
  posts: number;
  subject: string | null;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED';
  rejectedReason: string | null;
  questions: { id: string; prompt: string; kind: JobQuestionDraft['kind']; options: string[] }[];
  /** Everyone who has applied. */
  applicationCount?: number;
  /** Of those, the ones nobody has opened yet. The number that decides the day. */
  newApplicationCount?: number;
}

const STATUS_COPY: Record<Job['status'], string> = {
  DRAFT: 'Not sent yet',
  PENDING: 'With Sckools for review',
  APPROVED: 'Live on the jobs board',
  REJECTED: 'Sent back',
  CLOSED: 'Closed',
};

/**
 * Shorter words for a table cell, where the sentence above does not fit. The
 * full sentence is not thrown away — it rides along as the pill's title, so
 * "Live" can still explain itself to somebody who has not met it before.
 */
const STATUS_PILL: Record<Job['status'], { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING: { label: 'In review', tone: 'warn' },
  APPROVED: { label: 'Live', tone: 'good' },
  REJECTED: { label: 'Sent back', tone: 'bad' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

type JobFilter = 'ALL' | Job['status'];

const FILTERS: { key: JobFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'APPROVED', label: 'Live' },
  { key: 'PENDING', label: 'In review' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'REJECTED', label: 'Sent back' },
  { key: 'CLOSED', label: 'Closed' },
];

export default function JobsPage() {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'vacancies' | 'applications'>('vacancies');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<JobFilter>('ALL');

  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['manage-jobs'],
    queryFn: () => api.get('/manage/jobs'),
    enabled: !!host,
  });

  const create = useMutation({
    mutationFn: (body: unknown) => api.post('/manage/jobs', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manage-jobs'] });
      toast.success('Vacancy saved as a draft');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: (id: string) => api.post(`/manage/jobs/${id}/submit`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manage-jobs'] });
      toast.success('Sent to Sckools for review');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const all = jobs ?? [];
  const shown = filter === 'ALL' ? all : all.filter((j) => j.status === filter);
  const live = all.filter((j) => j.status === 'APPROVED').length;
  const inReview = all.filter((j) => j.status === 'PENDING').length;
  const drafts = all.filter((j) => j.status === 'DRAFT' || j.status === 'REJECTED').length;
  const unread = all.reduce((n, j) => n + (j.newApplicationCount ?? 0), 0);

  return (
    <div className="skosx">
      <header className="sk-pagehead flex items-start justify-between gap-3">
        <div>
          <h1>Jobs</h1>
          <p>
            Vacancies you post appear on the Sckools jobs board once we have reviewed them. They do
            not appear on your own school website.
          </p>
        </div>
      </header>

      {/* The four numbers that decide what an admin does next. Unread
          applications leads, because a posting nobody has opened is the only
          one of these that is costing the school a candidate. */}
      <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
        <button className="sk-kpi" type="button" data-tone={unread > 0 ? 'warn' : undefined} onClick={() => setTab('applications')}>
          <span className="lab">New applications</span>
          <span className="n sk-num">{unread}</span>
          <span className="hint">{unread > 0 ? 'nobody has opened these' : 'all caught up'}</span>
        </button>
        <button className="sk-kpi" type="button" data-tone="good" aria-pressed={filter === 'APPROVED'} onClick={() => setFilter(filter === 'APPROVED' ? 'ALL' : 'APPROVED')}>
          <span className="lab">Live</span>
          <span className="n sk-num">{live}</span>
          <span className="hint">on the jobs board</span>
        </button>
        <button className="sk-kpi" type="button" aria-pressed={filter === 'PENDING'} onClick={() => setFilter(filter === 'PENDING' ? 'ALL' : 'PENDING')}>
          <span className="lab">With Sckools</span>
          <span className="n sk-num">{inReview}</span>
          <span className="hint">waiting on our review</span>
        </button>
        <button className="sk-kpi" type="button" aria-pressed={filter === 'DRAFT'} onClick={() => setFilter(filter === 'DRAFT' ? 'ALL' : 'DRAFT')}>
          <span className="lab">Not sent</span>
          <span className="n sk-num">{drafts}</span>
          <span className="hint">{drafts > 0 ? 'nobody can see these yet' : 'nothing waiting on you'}</span>
        </button>
      </div>

      <nav className="sk-tabs sk-lib-tabs" style={{ marginTop: 18 }} aria-label="Jobs sections">
        {(['vacancies', 'applications'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className="sk-tab"
            data-active={tab === t}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => setTab(t)}
          >
            {t === 'vacancies' ? 'Vacancies' : 'Applications'}
            {t === 'applications' && unread > 0 ? <span className="sk-pill" data-tone="warn">{unread}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'vacancies' && (
        <>
          <NewVacancy onCreate={(body) => create.mutate(body)} busy={create.isPending} />

          <div className="sk-toolbar" style={{ marginTop: 18 }} role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="sk-enq-chip"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label} {f.key === 'ALL' ? all.length : all.filter((j) => j.status === f.key).length}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="sk-state">
              {all.length === 0 ? 'No vacancies yet. Start from a role above.' : 'Nothing with that status.'}
            </p>
          ) : (
            <div className="sk-card" style={{ overflow: 'hidden' }}>
              <div className="sk-tblwrap">
                <table className="sk-tbl">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th data-priority="2">Posts</th>
                      <th>Status</th>
                      <th>Applications</th>
                      <th className="acts"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((job) => {
                      const pill = STATUS_PILL[job.status];
                      const total = job.applicationCount ?? 0;
                      const fresh = job.newApplicationCount ?? 0;
                      return (
                        <tr key={job.id}>
                          <td data-wrap="true">
                            <span style={{ fontWeight: 650 }}>{job.title}</span>
                            <span className="sk-muted" style={{ display: 'block', fontSize: 11.5 }}>
                              {job.summary}
                            </span>
                            {job.status === 'REJECTED' && job.rejectedReason ? (
                              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--sk-amber-ink)' }}>
                                Reason: {job.rejectedReason}
                              </span>
                            ) : null}
                          </td>
                          <td data-priority="2" className="num">{job.posts}</td>
                          <td>
                            <span className="sk-pill" data-tone={pill.tone} title={STATUS_COPY[job.status]}>
                              {pill.label}
                            </span>
                          </td>
                          <td>
                            {/* A count on its own is a number to ignore. The
                                unread one is the reason to click. */}
                            <span className="pairs">
                              <span className="sk-num">{total}</span>
                              {fresh > 0 ? <span className="sk-pill" data-tone="warn">{fresh} new</span> : null}
                            </span>
                          </td>
                          <td className="acts">
                            <span>
                              {(job.status === 'DRAFT' || job.status === 'REJECTED') && (
                                <button
                                  className="sk-btn"
                                  data-size="sm"
                                  data-variant="primary"
                                  type="button"
                                  disabled={submit.isPending}
                                  onClick={() => submit.mutate(job.id)}
                                >
                                  Send for review
                                </button>
                              )}
                              <button
                                className="sk-btn"
                                data-size="sm"
                                type="button"
                                onClick={() => {
                                  setOpenId(job.id);
                                  setTab('applications');
                                }}
                              >
                                Applications
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'applications' && <Applications jobs={jobs ?? []} openId={openId} onPick={setOpenId} />}
    </div>
  );
}

/**
 * Posting a vacancy.
 *
 * It opens on TEMPLATES rather than an empty form. A school office can write
 * the prose; what it cannot easily do is invent four screening questions inside
 * a budget it has never met, where every question must become a filter. So the
 * templates carry the questions first — the hard part — and the words second.
 */
function NewVacancy({ onCreate, busy }: { onCreate: (body: unknown) => void; busy: boolean }) {
  const [picked, setPicked] = useState<JobTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [employmentType, setEmploymentType] = useState('FULL_TIME');
  const [posts, setPosts] = useState(1);
  const [questions, setQuestions] = useState<JobQuestionDraft[]>([]);

  function choose(t: JobTemplate) {
    setPicked(t);
    setTitle(t.fields.title);
    setSummary(t.fields.summary);
    setDescription(t.fields.description);
    setSubject(t.fields.subject ?? '');
    setEmploymentType(t.fields.employmentType);
    setQuestions(t.questions.map((q) => ({ ...q, options: [...q.options] })));
  }

  if (!picked) {
    return (
      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Post a vacancy</h3>
          <p className="text-sm text-[var(--sk-ink-3)]">
            Start from a role and edit anything. Each one comes with screening questions already set up — those
            become the filters on your applications list.
          </p>
        </div>
        <div className="sk-card-b">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {JOB_TEMPLATES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => choose(t)}
                className={[
                  'rounded-xl border p-3 text-left transition hover:border-[var(--sk-brand)] hover:shadow-sm',
                  t.value === 'BLANK' ? 'border-dashed border-[var(--sk-line-2)]' : 'border-[var(--sk-line)]',
                ].join(' ')}
              >
                <span className="block text-sm font-semibold text-[var(--sk-ink)]">{t.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--sk-ink-3)]">{t.hint}</span>
                {t.questions.length > 0 && (
                  <span className="mt-2 inline-block rounded-full bg-[var(--sk-brand-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sk-brand-2)]">
                    {t.questions.length} question{t.questions.length === 1 ? '' : 's'} ready
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const budgetLeft = MAX_QUESTIONS - questions.length;

  return (
    <div className="sk-card">
      <div className="sk-card-h" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3>{picked.value === 'BLANK' ? 'New vacancy' : picked.label}</h3>
          <p className="text-sm text-[var(--sk-ink-3)]">Everything here is editable — the template is only a head start.</p>
        </div>
        <button type="button" className="sk-btn" data-size="sm" onClick={() => setPicked(null)}>
          Change role
        </button>
      </div>
      <div className="sk-card-b" style={{ gap: 22 }}>
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sk-ink-3)]">The role</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-[var(--sk-ink-2)]">
              Job title
              <input className="sk-input" aria-label="Job title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginTop: 4 }} />
            </label>
            <label className="block text-sm font-semibold text-[var(--sk-ink-2)]">
              Subject or area <span className="font-normal text-[var(--sk-ink-3)]">(optional)</span>
              <input className="sk-input" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ marginTop: 4 }} />
            </label>
          </div>
          <label className="block text-sm font-semibold text-[var(--sk-ink-2)]">
            One-line summary
            <input className="sk-input" aria-label="One-line summary" value={summary} onChange={(e) => setSummary(e.target.value)} style={{ marginTop: 4 }} />
            <span className="mt-1 block text-[11px] font-normal text-[var(--sk-ink-3)]">
              This is the line candidates read on the jobs board before they click.
            </span>
          </label>
          <label className="block text-sm font-semibold text-[var(--sk-ink-2)]">
            Full description
            <textarea
              aria-label="Full description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-xl border border-[var(--sk-line)] px-3 py-2 text-sm font-normal"
            />
          </label>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sk-ink-3)]">Positions and terms</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-[var(--sk-ink-2)]">
              How many people do you need?
              <input className="sk-input"
                aria-label="Number of positions"
                type="number"
                min={1}
                value={posts}
                onChange={(e) => setPosts(Math.max(1, Number(e.target.value) || 1))}
                style={{ marginTop: 4, width: 96 }}
              />
              <span className="mt-1 block text-[11px] font-normal text-[var(--sk-ink-3)]">
                Shown on the listing — “3 positions” tells a candidate far more than “we are hiring”.
              </span>
            </label>
            <label className="block text-sm font-semibold text-[var(--sk-ink-2)]">
              Type
              <select
                aria-label="Employment type"
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
                className="mt-1 block rounded-xl border border-[var(--sk-line)] px-3 py-2 text-sm font-normal"
              >
                <option value="FULL_TIME">Full time</option>
                <option value="PART_TIME">Part time</option>
                <option value="CONTRACT">Contract</option>
                <option value="TEMPORARY">Temporary</option>
              </select>
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sk-ink-3)]">Screening questions</h3>
            {/* The budget is shown, not discovered on save. */}
            <span className={`text-[11px] font-semibold ${budgetLeft === 0 ? 'text-[var(--sk-amber-ink)]' : 'text-[var(--sk-ink-3)]'}`}>
              {questions.length} of {MAX_QUESTIONS} used
            </span>
          </div>
          <p className="text-[11px] text-[var(--sk-ink-3)]">
            Every answer becomes a filter on your applications list. Four is the maximum — each one costs the
            candidate something, and the benefit lands on you.
          </p>

          {questions.map((q, i) => (
            <div key={i} className="rounded-xl border border-[var(--sk-line)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input className="sk-input"
                  aria-label={`Question ${i + 1}`}
                  value={q.prompt}
                  onChange={(e) => setQuestions((qs) => qs.map((x, xi) => (xi === i ? { ...x, prompt: e.target.value } : x)))}
                  style={{ maxWidth: 380 }}
                />
                <select
                  aria-label={`Answer type for question ${i + 1}`}
                  value={q.kind}
                  onChange={(e) =>
                    setQuestions((qs) =>
                      qs.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as JobQuestionDraft['kind'] } : x)),
                    )
                  }
                  className="rounded-lg border border-[var(--sk-line)] px-2 py-1.5 text-xs"
                >
                  <option value="CHOICE">Choose one</option>
                  <option value="YES_NO">Yes / No</option>
                  <option value="NUMBER">A number</option>
                  <option value="TEXT">Free text</option>
                </select>
                <button
                  type="button"
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() => setQuestions((qs) => qs.filter((_, xi) => xi !== i))}
                  className="ml-auto rounded px-2 py-1 text-xs text-[var(--sk-ink-3)] hover:bg-[var(--sk-bg-2)] hover:text-[var(--sk-ink-2)]"
                >
                  Remove
                </button>
              </div>
              {q.kind === 'CHOICE' && (
                <input className="sk-input"
                  aria-label={`Options for question ${i + 1}`}
                  placeholder="Options, comma separated"
                  value={q.options.join(', ')}
                  onChange={(e) =>
                    setQuestions((qs) =>
                      qs.map((x, xi) =>
                        xi === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) } : x,
                      ),
                    )
                  }
                  style={{ marginTop: 8, maxWidth: 440 }}
                />
              )}
              {!filterableKinds.includes(q.kind) && (
                <p className="mt-2 text-[11px] font-semibold text-[var(--sk-amber-ink)]">
                  Free text cannot be filtered — you will read every answer by hand.
                </p>
              )}
            </div>
          ))}

          <button
            type="button"
            className="sk-btn"
            data-size="sm"
            disabled={budgetLeft === 0}
            onClick={() => setQuestions((qs) => [...qs, { prompt: '', kind: 'CHOICE', options: [], required: false }])}
          >
            {budgetLeft === 0 ? 'Four is the maximum' : 'Add a question'}
          </button>
        </section>

        {/* WHAT THE CANDIDATE SEES.
            The form asks for a title, a summary and a description without ever
            showing which of them a candidate actually reads first — so a
            summary written as an afterthought ended up being the whole advert
            on the jobs board. This mirrors the public listing's own layout, so
            the writing is judged in the shape it will be read in. */}
        <section className="space-y-2 border-t pt-4" style={{ borderColor: 'var(--sk-line)' }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sk-ink-3)]">
            How candidates will see it
          </h3>
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--sk-paper)', border: '1px solid var(--sk-line)' }}
          >
            <p className="text-lg font-bold" style={{ color: 'var(--sk-ink)' }}>
              {title.trim() || 'Job title'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="sk-pill" data-tone="info">
                {EMPLOYMENT_LABEL[employmentType as keyof typeof EMPLOYMENT_LABEL] ?? employmentType}
              </span>
              {subject.trim() && <span className="sk-pill">{subject.trim()}</span>}
              {posts > 1 && (
                <span className="sk-pill" data-tone="warn">
                  {posts} positions
                </span>
              )}
            </div>
            <p className="mt-3 text-sm" style={{ color: 'var(--sk-ink-2)' }}>
              {summary.trim() || 'Your one-line summary appears here — this is the line candidates read on the board before they click.'}
            </p>
            {description.trim() && (
              <p
                className="mt-3 whitespace-pre-wrap text-[13px]"
                style={{ color: 'var(--sk-ink-3)' }}
              >
                {description.trim().slice(0, 300)}
                {description.trim().length > 300 ? '…' : ''}
              </p>
            )}
            {questions.filter((q) => q.prompt.trim()).length > 0 && (
              <p className="mt-3 text-[11px]" style={{ color: 'var(--sk-ink-3)' }}>
                Then {questions.filter((q) => q.prompt.trim()).length} screening question
                {questions.filter((q) => q.prompt.trim()).length === 1 ? '' : 's'} before they can apply.
              </p>
            )}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--sk-line)] pt-4">
          <button type="button" className="sk-btn" data-variant="primary"
            disabled={busy || !title.trim() || !summary.trim() || !description.trim()}
            onClick={() =>
              onCreate({
                title,
                summary,
                description,
                posts,
                employmentType,
                subject: subject.trim() || undefined,
                questions: questions.filter((q) => q.prompt.trim()),
              })
            }
          >
            Save as draft
          </button>
          <span className="text-[11px] text-[var(--sk-ink-3)]">
            Saved as a draft — it only reaches the jobs board after you send it for review.
          </span>
        </div>
      </div>
    </div>
  );
}

/** The desk: every filterable question becomes a filter, automatically. */
function Applications({
  jobs,
  openId,
  onPick,
}: {
  jobs: Job[];
  openId: string | null;
  onPick: (id: string) => void;
}) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const jobId = openId ?? jobs[0]?.id ?? null;
  const job = jobs.find((j) => j.id === jobId);

  const { data } = useQuery<{ applications: Application[] }>({
    queryKey: ['job-applications', jobId],
    queryFn: () => api.get(`/manage/jobs/${jobId}/applications`),
    enabled: !!jobId,
  });

  const rows = (data?.applications ?? []).filter((a) =>
    Object.entries(filters).every(([qid, want]) => {
      if (!want) return true;
      const got = (a.answers ?? {})[qid];
      if (typeof got === 'number') return got >= Number(want);
      return String(got) === want;
    }),
  );

  if (!job) return <p className="text-sm text-[var(--sk-ink-3)]">Post a vacancy first.</p>;

  return (
    <div className="space-y-4">
      <select
        aria-label="Vacancy"
        value={jobId ?? ''}
        onChange={(e) => onPick(e.target.value)}
        className="rounded-lg border border-[var(--sk-line)] px-3 py-2 text-sm"
      >
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.title}
          </option>
        ))}
      </select>

      <div className="flex flex-wrap gap-2">
        {job.questions
          .filter((q) => filterableKinds.includes(q.kind))
          .map((q) => (
            <label key={q.id} className="text-xs font-semibold text-[var(--sk-ink-2)]">
              {q.prompt}
              {q.kind === 'CHOICE' && (
                <select
                  aria-label={`Filter by ${q.prompt}`}
                  value={filters[q.id] ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [q.id]: e.target.value }))}
                  className="ml-2 rounded-lg border border-[var(--sk-line)] px-2 py-1 font-normal"
                >
                  <option value="">Any</option>
                  {q.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              )}
              {q.kind === 'YES_NO' && (
                <select
                  aria-label={`Filter by ${q.prompt}`}
                  value={filters[q.id] ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [q.id]: e.target.value }))}
                  className="ml-2 rounded-lg border border-[var(--sk-line)] px-2 py-1 font-normal"
                >
                  <option value="">Any</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              )}
              {q.kind === 'NUMBER' && (
                <input
                  aria-label={`Minimum ${q.prompt}`}
                  type="number"
                  value={filters[q.id] ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [q.id]: e.target.value }))}
                  placeholder="min"
                  className="ml-2 w-20 rounded-lg border border-[var(--sk-line)] px-2 py-1 font-normal"
                />
              )}
            </label>
          ))}
      </div>

      <div className="space-y-2">
        {rows.map((a) => (
          <div className="sk-card" key={a.id}>
            <div className="sk-card-h">
              <h3>{a.name}</h3>
              <p className="text-sm text-[var(--sk-ink-3)]">
                {a.email}
                {a.phone ? ` · ${a.phone}` : ''}
              </p>
              <a href={a.cvUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[var(--sk-brand-2)]">
                Open CV →
              </a>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-[var(--sk-ink-3)]">No applications match.</p>}
      </div>
    </div>
  );
}

interface Application {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  cvUrl: string;
  answers: Record<string, string | number | boolean> | null;
  status: string;
}
