'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface ClassSection {
  id: string;
  name: string;
  grade: { name: string };
}

interface Subject {
  id: string;
  code: string;
  name: string;
}

/** Dates arrive as ISO strings over the wire even though the API types them as Date. */
interface Exam {
  id: string;
  classSectionId: string;
  subjectId: string;
  title: string;
  scheduledAt: string;
  syllabus: string | null;
  maxMarks: number;
}

/** GET /manage/exams already splits the list for us. */
interface ExamList {
  upcoming: Exam[];
  past: Exam[];
}

const EMPTY_FORM = { subjectId: '', title: '', scheduledAt: '', syllabus: '', maxMarks: '100' };

export default function TeacherTestsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [classSectionId, setClassSectionId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  const classes = useQuery({
    queryKey: ['t-tests-classes'],
    enabled: !!host,
    queryFn: () => api.get<ClassSection[]>('/manage/classes'),
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
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Tests</h1>
        <p className="text-sm text-slate-500">
          Schedule a test and the class&apos;s students and guardians get an email straight away.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Class</CardTitle>
          <CardDescription>Everything on this page is scoped to the class you pick.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="tests-class">Class</Label>
          <Select
            id="tests-class"
            className="max-w-sm"
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
          {classes.error && (
            <p className="text-sm text-rose-600">{(classes.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule a test</CardTitle>
          <CardDescription>Students and guardians are emailed as soon as you save.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tests-subject">Subject</Label>
              <Select
                id="tests-subject"
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
              <Label htmlFor="tests-title">Title</Label>
              <Input
                id="tests-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Unit test 1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tests-when">Date &amp; time</Label>
              <Input
                id="tests-when"
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tests-max">Max marks</Label>
              <Input
                id="tests-max"
                inputMode="numeric"
                value={form.maxMarks}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxMarks: e.target.value.replace(/\D/g, '') }))
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tests-syllabus">Syllabus (optional)</Label>
              <Textarea
                id="tests-syllabus"
                rows={4}
                value={form.syllabus}
                onChange={(e) => setForm((f) => ({ ...f, syllabus: e.target.value }))}
                placeholder="Chapters 1–4, plus the worksheet from last week."
              />
            </div>
            <div className="sm:col-span-2">
              <Button disabled={!canCreate || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Scheduling…' : 'Schedule test'}
              </Button>
              {!classSectionId && (
                <p className="mt-2 text-sm text-slate-400">Pick a class first.</p>
              )}
            </div>
          </div>
          {subjects.error && (
            <p className="mt-3 text-sm text-rose-600">{(subjects.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled tests</CardTitle>
          <CardDescription>
            {classSectionId
              ? `${upcoming.length} upcoming · ${past.length} past`
              : 'Pick a class to see its tests.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {classSectionId && exams.isLoading && (
            <p className="text-sm text-slate-500">Loading tests…</p>
          )}
          {exams.error && <p className="text-sm text-rose-600">{(exams.error as Error).message}</p>}
          {classSectionId &&
            !exams.isLoading &&
            !exams.error &&
            upcoming.length === 0 &&
            past.length === 0 && (
              <p className="text-sm text-slate-400">No tests for this class yet.</p>
            )}

          {[
            { label: 'Upcoming', rows: upcoming, tone: 'info' as const },
            { label: 'Past', rows: past, tone: 'neutral' as const },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <div key={group.label} className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-slate-700">{group.label}</h2>
                <Table>
                  <THead>
                    <Tr>
                      <Th>Title</Th>
                      <Th>Subject</Th>
                      <Th>When</Th>
                      <Th>Max marks</Th>
                      <Th>Syllabus</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {group.rows.map((exam) => (
                      <Tr key={exam.id}>
                        <Td className="font-medium text-slate-900">{exam.title}</Td>
                        <Td className="text-slate-500">{subjectLabel(exam.subjectId)}</Td>
                        <Td>
                          <Badge tone={group.tone}>
                            {new Date(exam.scheduledAt).toLocaleString()}
                          </Badge>
                        </Td>
                        <Td>{exam.maxMarks}</Td>
                        <Td className="max-w-xs truncate text-slate-500">
                          {exam.syllabus ?? '—'}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
