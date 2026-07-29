'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ClassSectionSummary, Exam, ExamList, Subject } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

const EMPTY_FORM = { subjectId: '', title: '', scheduledAt: '', syllabus: '', maxMarks: '100' };

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

const SUBJECT_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

export default function TeacherTestsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [classSectionId, setClassSectionId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  const classes = useQuery({
    queryKey: ['t-tests-classes'],
    enabled: !!host,
    queryFn: () => api.get<ClassSectionSummary[]>('/manage/classes'),
    staleTime: 30_000,
  });

  const subjects = useQuery({
    queryKey: ['t-tests-subjects'],
    enabled: !!host,
    queryFn: () => api.get<Subject[]>('/manage/subjects'),
    staleTime: 30_000,
  });

  const exams = useQuery({
    queryKey: ['t-exams', classSectionId],
    enabled: !!host && !!classSectionId,
    queryFn: () =>
      api.get<ExamList>(`/manage/exams?classSectionId=${encodeURIComponent(classSectionId)}`),
  });

  const maxMarks = Number(form.maxMarks);
  const canCreate =
    !!classSectionId &&
    !!form.subjectId &&
    form.title.trim().length > 0 &&
    !!form.scheduledAt &&
    Number.isInteger(maxMarks) &&
    maxMarks > 0;

  const create = useMutation({
    mutationFn: () =>
      api.post<Exam>('/manage/exams', {
        classSectionId,
        subjectId: form.subjectId,
        title: form.title.trim(),
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        syllabus: form.syllabus.trim() || undefined,
        maxMarks,
      }),
    onSuccess: (exam) => {
      toast.success(`"${exam.title}" scheduled — the class is being notified by email.`);
      setForm(EMPTY_FORM);
      void qc.invalidateQueries({ queryKey: ['t-exams', classSectionId] });
    },
    // { code, message } envelope — surface the message as-is.
    onError: (e: Error) => toast.error(e.message),
  });

  const subjectLabel = (subjectId: string) => {
    const subject = (subjects.data ?? []).find((s) => s.id === subjectId);
    return subject ? `${subject.code} — ${subject.name}` : '—';
  };

  const upcoming = exams.data?.upcoming ?? [];
  const past = exams.data?.past ?? [];

  return (
    <>
      <header className="sk-pagehead">
        <h1>Tests</h1>
        <p>Schedule a test and the class&apos;s students and guardians get an email straight away.</p>
      </header>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Class</h3>
        </div>
        <div className="sk-card-b">
          <label htmlFor="tests-class" className="sk-lab">
            Class
          </label>
          <Select
            id="tests-class"
            className={`${fieldCls} max-w-sm`}
            value={classSectionId}
            onChange={(e) => setClassSectionId(e.target.value)}
          >
            <option value="">Pick a class…</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.grade.name} · {c.name}
              </option>
            ))}
          </Select>
          {classes.error && <p className="sk-state err">{(classes.error as Error).message}</p>}
        </div>
      </div>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Schedule a test</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            Students and guardians are emailed as soon as you save.
          </p>
        </div>
        <div className="sk-card-b">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="tests-subject" className="sk-lab">
                Subject
              </label>
              <Select
                id="tests-subject"
                className={`${fieldCls} w-full`}
                value={form.subjectId}
                onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
              >
                <option value="">—</option>
                {(subjects.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="tests-title" className="sk-lab">
                Title
              </label>
              <Input
                id="tests-title"
                className={`${fieldCls} w-full`}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Unit test 1"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="tests-when" className="sk-lab">
                Date &amp; time
              </label>
              <Input
                id="tests-when"
                type="datetime-local"
                className={`${fieldCls} w-full`}
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="tests-max" className="sk-lab">
                Max marks
              </label>
              <Input
                id="tests-max"
                inputMode="numeric"
                className={`${fieldCls} w-full`}
                value={form.maxMarks}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxMarks: e.target.value.replace(/\D/g, '') }))
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="tests-syllabus" className="sk-lab">
                Syllabus (optional)
              </label>
              <Textarea
                id="tests-syllabus"
                rows={4}
                className={`${fieldCls} w-full`}
                value={form.syllabus}
                onChange={(e) => setForm((f) => ({ ...f, syllabus: e.target.value }))}
                placeholder="Chapters 1–4, plus the worksheet from last week."
              />
            </div>
            <div className="sm:col-span-2" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="sk-btn"
                data-variant="primary"
                disabled={!canCreate || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Scheduling…' : 'Schedule test'}
              </button>
              {!classSectionId && <span className="sk-muted">Pick a class first.</span>}
            </div>
          </div>
          {subjects.error && (
            <p className="sk-state err" style={{ marginTop: 12 }}>
              {(subjects.error as Error).message}
            </p>
          )}
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Scheduled tests</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            {classSectionId
              ? `${upcoming.length} upcoming · ${past.length} past`
              : 'Pick a class to see its tests.'}
          </p>
        </div>
        <div className="sk-card-b">
          {classSectionId && exams.isLoading && <p className="sk-state">Loading tests…</p>}
          {exams.error && <p className="sk-state err">{(exams.error as Error).message}</p>}
          {classSectionId &&
            !exams.isLoading &&
            !exams.error &&
            upcoming.length === 0 &&
            past.length === 0 && <p className="sk-state">No tests for this class yet.</p>}

          {[
            { label: 'Upcoming', rows: upcoming, tone: 'info' as const },
            { label: 'Past', rows: past, tone: undefined },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <div key={group.label} style={{ marginBottom: 16 }}>
                <span className="sk-lab">{group.label}</span>
                <div style={{ marginTop: 8 }}>
                  {group.rows.map((exam, i) => (
                    <div className="sk-row" key={exam.id}>
                      <span
                        className="badge"
                        style={{ background: SUBJECT_COLORS[i % SUBJECT_COLORS.length] }}
                      >
                        {(subjects.data ?? []).find((s) => s.id === exam.subjectId)?.code.slice(0, 2).toUpperCase() ??
                          '—'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="nm">{exam.title}</div>
                        <div className="meta">
                          {subjectLabel(exam.subjectId)} · {new Date(exam.scheduledAt).toLocaleString()} · out of{' '}
                          {exam.maxMarks}
                        </div>
                        {exam.syllabus && (
                          <div
                            className="meta"
                            style={{ marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          >
                            {exam.syllabus}
                          </div>
                        )}
                      </div>
                      <span className="sp" />
                      <span className="sk-pill" data-tone={group.tone}>
                        {group.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
