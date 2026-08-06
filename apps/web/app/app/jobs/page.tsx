'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MAX_QUESTIONS, filterableKinds, type JobQuestionDraft } from '@/lib/jobs-admin';
import { JOB_TEMPLATES, type JobTemplate } from '@/lib/job-templates';

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
}

const STATUS_COPY: Record<Job['status'], string> = {
  DRAFT: 'Not sent yet',
  PENDING: 'With Sckools for review',
  APPROVED: 'Live on the jobs board',
  REJECTED: 'Sent back',
  CLOSED: 'Closed',
};

export default function JobsPage() {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'vacancies' | 'applications'>('vacancies');
  const [openId, setOpenId] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
        <p className="text-sm text-slate-500">
          Vacancies you post appear on the Sckools jobs board once we have reviewed them. They do not appear on your
          own school website.
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {(['vacancies', 'applications'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold capitalize ${
              tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'vacancies' && (
        <>
          <NewVacancy onCreate={(body) => create.mutate(body)} busy={create.isPending} />
          <div className="space-y-3">
            {(jobs ?? []).map((job) => (
              <Card key={job.id}>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle>{job.title}</CardTitle>
                    <p className="text-sm text-slate-500">{job.summary}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">
                      {STATUS_COPY[job.status]}
                      {job.posts > 1 ? ` · ${job.posts} positions` : ''}
                    </p>
                    {job.status === 'REJECTED' && job.rejectedReason && (
                      <p className="mt-1 text-xs text-amber-700">Reason: {job.rejectedReason}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {(job.status === 'DRAFT' || job.status === 'REJECTED') && (
                      <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate(job.id)}>
                        Send for review
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => { setOpenId(job.id); setTab('applications'); }}>
                      Applications
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            ))}
            {(jobs ?? []).length === 0 && (
              <p className="text-sm text-slate-500">No vacancies yet.</p>
            )}
          </div>
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
      <Card>
        <CardHeader>
          <CardTitle>Post a vacancy</CardTitle>
          <p className="text-sm text-slate-500">
            Start from a role and edit anything. Each one comes with screening questions already set up — those
            become the filters on your applications list.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {JOB_TEMPLATES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => choose(t)}
                className={[
                  'rounded-xl border p-3 text-left transition hover:border-teal-500 hover:shadow-sm',
                  t.value === 'BLANK' ? 'border-dashed border-slate-300' : 'border-slate-200',
                ].join(' ')}
              >
                <span className="block text-sm font-semibold text-slate-800">{t.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{t.hint}</span>
                {t.questions.length > 0 && (
                  <span className="mt-2 inline-block rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">
                    {t.questions.length} question{t.questions.length === 1 ? '' : 's'} ready
                  </span>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const budgetLeft = MAX_QUESTIONS - questions.length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{picked.value === 'BLANK' ? 'New vacancy' : picked.label}</CardTitle>
          <p className="text-sm text-slate-500">Everything here is editable — the template is only a head start.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
          Change role
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">The role</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              Job title
              <Input aria-label="Job title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 font-normal" />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Subject or area <span className="font-normal text-slate-400">(optional)</span>
              <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 font-normal" />
            </label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            One-line summary
            <Input aria-label="One-line summary" value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-1 font-normal" />
            <span className="mt-1 block text-[11px] font-normal text-slate-400">
              This is the line candidates read on the jobs board before they click.
            </span>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Full description
            <textarea
              aria-label="Full description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal"
            />
          </label>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Positions and terms</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              How many people do you need?
              <Input
                aria-label="Number of positions"
                type="number"
                min={1}
                value={posts}
                onChange={(e) => setPosts(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 w-24 font-normal"
              />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">
                Shown on the listing — “3 positions” tells a candidate far more than “we are hiring”.
              </span>
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Type
              <select
                aria-label="Employment type"
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
                className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal"
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
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Screening questions</h3>
            {/* The budget is shown, not discovered on save. */}
            <span className={`text-[11px] font-semibold ${budgetLeft === 0 ? 'text-amber-700' : 'text-slate-400'}`}>
              {questions.length} of {MAX_QUESTIONS} used
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Every answer becomes a filter on your applications list. Four is the maximum — each one costs the
            candidate something, and the benefit lands on you.
          </p>

          {questions.map((q, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={`Question ${i + 1}`}
                  value={q.prompt}
                  onChange={(e) => setQuestions((qs) => qs.map((x, xi) => (xi === i ? { ...x, prompt: e.target.value } : x)))}
                  className="max-w-sm"
                />
                <select
                  aria-label={`Answer type for question ${i + 1}`}
                  value={q.kind}
                  onChange={(e) =>
                    setQuestions((qs) =>
                      qs.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as JobQuestionDraft['kind'] } : x)),
                    )
                  }
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
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
                  className="ml-auto rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  Remove
                </button>
              </div>
              {q.kind === 'CHOICE' && (
                <Input
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
                  className="mt-2 max-w-md"
                />
              )}
              {!filterableKinds.includes(q.kind) && (
                <p className="mt-2 text-[11px] font-semibold text-amber-700">
                  Free text cannot be filtered — you will read every answer by hand.
                </p>
              )}
            </div>
          ))}

          <Button
            size="sm"
            variant="outline"
            disabled={budgetLeft === 0}
            onClick={() => setQuestions((qs) => [...qs, { prompt: '', kind: 'CHOICE', options: [], required: false }])}
          >
            {budgetLeft === 0 ? 'Four is the maximum' : 'Add a question'}
          </Button>
        </section>

        <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
          <Button
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
          </Button>
          <span className="text-[11px] text-slate-400">
            Saved as a draft — it only reaches the jobs board after you send it for review.
          </span>
        </div>
      </CardContent>
    </Card>
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

  if (!job) return <p className="text-sm text-slate-500">Post a vacancy first.</p>;

  return (
    <div className="space-y-4">
      <select
        aria-label="Vacancy"
        value={jobId ?? ''}
        onChange={(e) => onPick(e.target.value)}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
            <label key={q.id} className="text-xs font-semibold text-slate-600">
              {q.prompt}
              {q.kind === 'CHOICE' && (
                <select
                  aria-label={`Filter by ${q.prompt}`}
                  value={filters[q.id] ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [q.id]: e.target.value }))}
                  className="ml-2 rounded-lg border border-slate-200 px-2 py-1 font-normal"
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
                  className="ml-2 rounded-lg border border-slate-200 px-2 py-1 font-normal"
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
                  className="ml-2 w-20 rounded-lg border border-slate-200 px-2 py-1 font-normal"
                />
              )}
            </label>
          ))}
      </div>

      <div className="space-y-2">
        {rows.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle>{a.name}</CardTitle>
              <p className="text-sm text-slate-500">
                {a.email}
                {a.phone ? ` · ${a.phone}` : ''}
              </p>
              <a href={a.cvUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-teal-700">
                Open CV →
              </a>
            </CardHeader>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-500">No applications match.</p>}
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
