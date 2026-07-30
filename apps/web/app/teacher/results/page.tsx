'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ExamList,
  MyClassSection,
  PublishResultsResponse,
  RosterStudent,
  SavedResult,
  SaveResultsResponse,
} from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

function initials(firstName: string, lastName: string): string {
  return `${firstName.slice(0, 1)}${lastName.slice(0, 1)}`.toUpperCase();
}

function ConfirmPublish({
  examTitle,
  isPending,
  onConfirm,
  onCancel,
}: {
  examTitle: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="sk-card" style={{ width: '100%', maxWidth: 400 }}>
        <div className="sk-card-h">
          <h3>Publish results for {examTitle}?</h3>
        </div>
        <div className="sk-card-b">
          <div
            style={{
              borderRadius: 12,
              padding: '12px 14px',
              fontSize: 12.5,
              lineHeight: 1.5,
              background: 'var(--sk-amber-tint)',
              color: 'var(--sk-late)',
              borderLeft: '3px solid var(--sk-amber)',
            }}
          >
            Publishing makes every saved mark visible to students and parents, and emails them that
            results are out. Save any pending marks first — only marks already saved get published.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="sk-btn" data-variant="primary" disabled={isPending} onClick={onConfirm}>
              {isPending ? 'Publishing…' : 'Yes, publish'}
            </button>
            <button type="button" className="sk-btn" disabled={isPending} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TeacherResultsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const [classSectionId, setClassSectionId] = useState('');
  const [examId, setExamId] = useState('');
  // Kept as raw strings so a half-typed value never becomes NaN mid-keystroke.
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  const classes = useQuery({
    queryKey: ['t-results-classes'],
    enabled: !!host,
    queryFn: () => api.get<MyClassSection[]>('/manage/attendance/my-classes'),
    staleTime: 30_000,
  });

  // A TEACHER may only enter/publish results for sections they own —
  // ResultsService rejects `covering: true` sections with a 403
  // CLASS_NOT_OWNED. Filtering here means the picker never offers a class
  // the server will refuse.
  const ownedClasses = (classes.data ?? []).filter((c) => !c.covering);

  const exams = useQuery({
    queryKey: ['t-results-exams', classSectionId],
    enabled: !!host && !!classSectionId,
    queryFn: () =>
      api.get<ExamList>(`/manage/exams?classSectionId=${encodeURIComponent(classSectionId)}`),
  });

  const roster = useQuery({
    queryKey: ['t-results-roster', classSectionId],
    enabled: !!host && !!classSectionId,
    queryFn: () =>
      api.get<RosterStudent[]>(
        `/manage/students?classSectionId=${encodeURIComponent(classSectionId)}`,
      ),
  });

  // Marks already saved for the selected exam, so the teacher sees what is on
  // record instead of a blank grid (and can't be fooled into re-keying it).
  const saved = useQuery({
    queryKey: ['t-results-saved', examId],
    enabled: !!host && !!examId,
    queryFn: () => api.get<SavedResult[]>(`/manage/exams/${encodeURIComponent(examId)}/results`),
  });

  // Seed the inputs from the saved marks whenever a different exam's marks
  // arrive. Keyed on examId so switching exams re-seeds, but typing does not
  // get clobbered by a refetch of the same exam.
  const seededExamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!examId || !saved.data) return;
    if (seededExamRef.current === examId) return;
    seededExamRef.current = examId;
    setEntries(
      Object.fromEntries(saved.data.map((r) => [r.studentId, String(r.marks)])),
    );
  }, [examId, saved.data]);

  const alreadyPublished = (saved.data ?? []).some((r) => r.publishedAt !== null);

  // Past exams come first — those are the ones a teacher actually has marks for.
  const allExams = useMemo(
    () => [...(exams.data?.past ?? []), ...(exams.data?.upcoming ?? [])],
    [exams.data],
  );
  const exam = allExams.find((e) => e.id === examId);
  const students = useMemo(() => roster.data ?? [], [roster.data]);

  const parsed = useMemo(
    () =>
      students
        .map((s) => ({ studentId: s.id, raw: entries[s.id] ?? '' }))
        .filter((e) => e.raw.trim() !== '')
        .map((e) => ({ studentId: e.studentId, marks: Number(e.raw) })),
    [students, entries],
  );

  const valid = useMemo(
    () =>
      !!exam &&
      parsed.length > 0 &&
      parsed.every((m) => Number.isFinite(m.marks) && m.marks >= 0 && m.marks <= exam.maxMarks),
    [parsed, exam],
  );

  const average = useMemo(() => {
    const usable = parsed.filter((m) => Number.isFinite(m.marks));
    if (usable.length === 0) return null;
    return usable.reduce((sum, m) => sum + m.marks, 0) / usable.length;
  }, [parsed]);

  const save = useMutation({
    mutationFn: () =>
      api.put<SaveResultsResponse>(`/manage/exams/${examId}/results`, { marks: parsed }),
    onSuccess: (result) => {
      toast.success(`Saved marks for ${result.saved} students.`);
      void saved.refetch();
    },
    // { code, message } envelope — includes the server's 0..maxMarks VALIDATION text.
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: () => api.post<PublishResultsResponse>(`/manage/exams/${examId}/publish`, {}),
    onSuccess: (result) => {
      setConfirming(false);
      toast.success(
        result.published === 0
          ? 'Nothing to publish — save some marks first.'
          : `Published ${result.published} results. Students and parents are being emailed.`,
      );
      void saved.refetch();
    },
    onError: (e: Error) => {
      setConfirming(false);
      toast.error(e.message);
    },
  });

  const rosterError = roster.error as Error | undefined;

  return (
    <>
      {confirming && exam && (
        <ConfirmPublish
          examTitle={exam.title}
          isPending={publish.isPending}
          onConfirm={() => publish.mutate()}
          onCancel={() => setConfirming(false)}
        />
      )}

      <header className="sk-pagehead">
        <h1>Results</h1>
        <p>
          Enter marks for a test, then publish when you&apos;re ready for students and parents to
          see them.
        </p>
      </header>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Pick a test</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            Marks are entered against the class roster.
          </p>
        </div>
        <div className="sk-card-b">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="res-class" className="sk-lab">
                Class
              </label>
              <Select
                id="res-class"
                className={`${fieldCls} w-full`}
                value={classSectionId}
                onChange={(e) => {
                  setClassSectionId(e.target.value);
                  setExamId('');
                  setEntries({});
                }}
              >
                <option value="">Pick a class…</option>
                {ownedClasses.map((c) => (
                  <option key={c.classSectionId} value={c.classSectionId}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="res-exam" className="sk-lab">
                Test
              </label>
              <Select
                id="res-exam"
                className={`${fieldCls} w-full`}
                value={examId}
                disabled={!classSectionId || allExams.length === 0}
                onChange={(e) => {
                  setExamId(e.target.value);
                  setEntries({});
                }}
              >
                <option value="">Pick a test…</option>
                {allExams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {new Date(e.scheduledAt).toLocaleDateString()} · /{e.maxMarks}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {classes.error && <p className="sk-state err">{(classes.error as Error).message}</p>}
          {exams.error && <p className="sk-state err">{(exams.error as Error).message}</p>}
          {classSectionId && !exams.isLoading && !exams.error && allExams.length === 0 && (
            <p className="sk-state">No tests scheduled for this class yet — schedule one from the Tests page.</p>
          )}
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h3>Marks</h3>
              <p className="sk-muted" style={{ marginTop: 4 }}>
                {exam
                  ? `Out of ${exam.maxMarks} · ${parsed.length} of ${students.length} entered${
                      average === null ? '' : ` · class average ${average.toFixed(1)}`
                    }`
                  : 'Pick a class and a test above.'}
              </p>
            </div>
            {exam && alreadyPublished && (
              <span className="sk-pill" data-tone="good">
                Published
              </span>
            )}
          </div>
          {exam && alreadyPublished && (
            <p className="sk-muted" style={{ marginTop: 8, color: 'var(--sk-late)' }}>
              These results are already published. Publishing again re-sends the notification
              email to every student and parent in this class.
            </p>
          )}
          {exam && saved.isLoading && (
            <p className="sk-muted" style={{ marginTop: 8 }}>
              Loading saved marks…
            </p>
          )}
        </div>
        <div className="sk-card-b">
          {classSectionId && roster.isLoading && <p className="sk-state">Loading roster…</p>}
          {rosterError && <p className="sk-state err">{rosterError.message}</p>}
          {classSectionId && !roster.isLoading && !rosterError && students.length === 0 && (
            <p className="sk-state">No students in this class yet — your admin needs to enrol them.</p>
          )}

          {exam && students.length > 0 && (
            <>
              <div>
                {students.map((s, i) => {
                  const raw = entries[s.id] ?? '';
                  const num = Number(raw);
                  const bad =
                    raw.trim() !== '' &&
                    (!Number.isFinite(num) || num < 0 || num > exam.maxMarks);
                  return (
                    <div className="sk-row" key={s.id}>
                      <span className="badge" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                        {initials(s.firstName, s.lastName)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="nm">
                          {s.firstName} {s.lastName}
                        </div>
                        <div className="meta">Roll {s.rollNo ?? '—'}</div>
                      </div>
                      <span className="sp" />
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={exam.maxMarks}
                        step="any"
                        aria-invalid={bad}
                        aria-label={`Marks for ${s.firstName} ${s.lastName}`}
                        className={`${fieldCls} w-24 text-right ${bad ? 'border-[var(--sk-bad)]' : ''}`}
                        value={raw}
                        onChange={(ev) =>
                          setEntries((m) => ({ ...m, [s.id]: ev.target.value }))
                        }
                      />
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  className="sk-btn"
                  data-variant="primary"
                  disabled={!valid || save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? 'Saving…' : 'Save marks'}
                </button>
                <button
                  type="button"
                  className="sk-btn"
                  disabled={publish.isPending}
                  onClick={() => setConfirming(true)}
                >
                  Publish results
                </button>
                {parsed.length > 0 && !valid && (
                  <span style={{ fontSize: 12.5, color: 'var(--sk-bad)' }}>
                    Every mark must be between 0 and {exam.maxMarks}.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
