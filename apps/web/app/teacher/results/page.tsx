'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface ClassSection {
  id: string;
  name: string;
  grade: { name: string };
}

interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  rollNo: string | null;
}

interface Exam {
  id: string;
  title: string;
  subjectId: string;
  scheduledAt: string;
  maxMarks: number;
}

interface ExamList {
  upcoming: Exam[];
  past: Exam[];
}

interface SaveResultsResult {
  saved: number;
}

interface PublishResult {
  published: number;
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
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Publish results for {examTitle}?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            Publishing makes every saved mark visible to students and parents, and emails them that
            results are out. Save any pending marks first — only marks already saved get published.
          </p>
        </CardContent>
        <CardFooter className="gap-2">
          <Button disabled={isPending} onClick={onConfirm}>
            {isPending ? 'Publishing…' : 'Yes, publish'}
          </Button>
          <Button variant="outline" disabled={isPending} onClick={onCancel}>
            Cancel
          </Button>
        </CardFooter>
      </Card>
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
    queryFn: () => api.get<ClassSection[]>('/manage/classes'),
    staleTime: 30_000,
  });

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
      api.put<SaveResultsResult>(`/manage/exams/${examId}/results`, { marks: parsed }),
    onSuccess: (result) => toast.success(`Saved marks for ${result.saved} students.`),
    // { code, message } envelope — includes the server's 0..maxMarks VALIDATION text.
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: () => api.post<PublishResult>(`/manage/exams/${examId}/publish`, {}),
    onSuccess: (result) => {
      setConfirming(false);
      toast.success(
        result.published === 0
          ? 'Nothing to publish — save some marks first.'
          : `Published ${result.published} results. Students and parents are being emailed.`,
      );
    },
    onError: (e: Error) => {
      setConfirming(false);
      toast.error(e.message);
    },
  });

  const rosterError = roster.error as Error | undefined;

  return (
    <div className="flex flex-col gap-6">
      {confirming && exam && (
        <ConfirmPublish
          examTitle={exam.title}
          isPending={publish.isPending}
          onConfirm={() => publish.mutate()}
          onCancel={() => setConfirming(false)}
        />
      )}

      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Results</h1>
        <p className="text-sm text-slate-500">
          Enter marks for a test, then publish when you&apos;re ready for students and parents to
          see them.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Pick a test</CardTitle>
          <CardDescription>Marks are entered against the class roster.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="res-class">Class</Label>
            <Select
              id="res-class"
              value={classSectionId}
              onChange={(e) => {
                setClassSectionId(e.target.value);
                setExamId('');
                setEntries({});
              }}
            >
              <option value="">Pick a class…</option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.grade.name} · {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="res-exam">Test</Label>
            <Select
              id="res-exam"
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
          {classes.error && (
            <p className="text-sm text-rose-600 sm:col-span-2">{(classes.error as Error).message}</p>
          )}
          {exams.error && (
            <p className="text-sm text-rose-600 sm:col-span-2">{(exams.error as Error).message}</p>
          )}
          {classSectionId && !exams.isLoading && !exams.error && allExams.length === 0 && (
            <p className="text-sm text-slate-400 sm:col-span-2">
              No tests scheduled for this class yet — schedule one from the Tests page.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marks</CardTitle>
          <CardDescription>
            {exam
              ? `Out of ${exam.maxMarks} · ${parsed.length} of ${students.length} entered${
                  average === null ? '' : ` · class average ${average.toFixed(1)}`
                }`
              : 'Pick a class and a test above.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {classSectionId && roster.isLoading && (
            <p className="text-sm text-slate-500">Loading roster…</p>
          )}
          {rosterError && <p className="text-sm text-rose-600">{rosterError.message}</p>}
          {classSectionId && !roster.isLoading && !rosterError && students.length === 0 && (
            <p className="text-sm text-slate-400">
              No students in this class yet — your admin needs to enrol them.
            </p>
          )}

          {exam && students.length > 0 && (
            <>
              <Table>
                <THead>
                  <Tr>
                    <Th>Roll no.</Th>
                    <Th>Student</Th>
                    <Th>Marks (out of {exam.maxMarks})</Th>
                  </Tr>
                </THead>
                <TBody>
                  {students.map((s) => {
                    const raw = entries[s.id] ?? '';
                    const num = Number(raw);
                    const bad =
                      raw.trim() !== '' &&
                      (!Number.isFinite(num) || num < 0 || num > exam.maxMarks);
                    return (
                      <Tr key={s.id}>
                        <Td className="text-slate-500">{s.rollNo ?? '—'}</Td>
                        <Td className="font-medium text-slate-900">
                          {s.firstName} {s.lastName}
                        </Td>
                        <Td>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={exam.maxMarks}
                            step="any"
                            aria-invalid={bad}
                            aria-label={`Marks for ${s.firstName} ${s.lastName}`}
                            className={bad ? 'max-w-[7rem] border-rose-400' : 'max-w-[7rem]'}
                            value={raw}
                            onChange={(ev) =>
                              setEntries((m) => ({ ...m, [s.id]: ev.target.value }))
                            }
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? 'Saving…' : 'Save marks'}
                </Button>
                <Button
                  variant="outline"
                  disabled={publish.isPending}
                  onClick={() => setConfirming(true)}
                >
                  Publish results
                </Button>
                {parsed.length > 0 && !valid && (
                  <span className="text-sm text-rose-600">
                    Every mark must be between 0 and {exam.maxMarks}.
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
