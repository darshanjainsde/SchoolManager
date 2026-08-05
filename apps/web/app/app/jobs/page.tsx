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

/** The question builder. Four maximum, and TEXT says plainly that it cannot be filtered. */
function NewVacancy({ onCreate, busy }: { onCreate: (body: unknown) => void; busy: boolean }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [posts, setPosts] = useState(1);
  const [questions, setQuestions] = useState<JobQuestionDraft[]>([]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Post a vacancy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input aria-label="Job title" placeholder="Job title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input aria-label="One-line summary" placeholder="One line — what the role is" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <textarea
          aria-label="Full description"
          placeholder="The full posting"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="block text-sm font-semibold text-slate-700">
          How many people do you need?
          <Input
            aria-label="Number of positions"
            type="number"
            min={1}
            value={posts}
            onChange={(e) => setPosts(Math.max(1, Number(e.target.value) || 1))}
            className="mt-1 w-24"
          />
        </label>

        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-700">Screening questions</p>
          <p className="text-xs text-slate-500">
            At most {MAX_QUESTIONS}. Every answer becomes a filter on your applications list — except free text,
            which cannot be filtered.
          </p>
          {questions.map((q, i) => (
            <div key={i} className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Question ${i + 1}`}
                value={q.prompt}
                onChange={(e) =>
                  setQuestions((qs) => qs.map((x, xi) => (xi === i ? { ...x, prompt: e.target.value } : x)))
                }
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
                  className="max-w-xs"
                />
              )}
              {!filterableKinds.includes(q.kind) && (
                <span className="text-xs text-amber-700">Cannot be filtered</span>
              )}
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={questions.length >= MAX_QUESTIONS}
            onClick={() => setQuestions((qs) => [...qs, { prompt: '', kind: 'CHOICE', options: [], required: false }])}
          >
            Add a question
          </Button>
        </div>

        <Button
          disabled={busy || !title.trim() || !summary.trim() || !description.trim()}
          onClick={() =>
            onCreate({ title, summary, description, posts, questions: questions.filter((q) => q.prompt.trim()) })
          }
        >
          Save as draft
        </Button>
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
