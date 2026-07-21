'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// The API only accepts these three (AttendanceMarkDto @IsIn). Anything else
// would be rejected server-side, so the UI never offers it.
type Status = 'PRESENT' | 'ABSENT' | 'LATE';
const STATUSES: Status[] = ['PRESENT', 'ABSENT', 'LATE'];
const STATUS_LABEL: Record<Status, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late' };
const STATUS_TONE: Record<Status, 'success' | 'danger' | 'warning'> = {
  PRESENT: 'success',
  ABSENT: 'danger',
  LATE: 'warning',
};

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

/** GET /manage/attendance returns marks only — unmarked students default to PRESENT. */
interface AttendanceMark {
  studentId: string;
  status: Status;
}

interface SaveAttendanceResult {
  saved: number;
  absentees: number;
}

/** Today in the browser's own timezone — `toISOString()` would give the UTC day. */
const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function TeacherAttendancePage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
      <TeacherAttendanceInner />
    </Suspense>
  );
}

function TeacherAttendanceInner() {
  const host = useHost();
  const params = useSearchParams();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  // `classId` is the legacy param name still used by links from /teacher.
  const [classSectionId, setClassSectionId] = useState(
    params.get('classSectionId') ?? params.get('classId') ?? '',
  );
  const [date, setDate] = useState(todayIso());

  const classes = useQuery({
    queryKey: ['t-attn-classes'],
    enabled: !!host,
    queryFn: () => api.get<ClassSection[]>('/manage/classes'),
    staleTime: 30_000,
  });

  const roster = useQuery({
    queryKey: ['t-attn-roster', classSectionId],
    enabled: !!host && !!classSectionId,
    queryFn: () =>
      api.get<RosterStudent[]>(
        `/manage/students?classSectionId=${encodeURIComponent(classSectionId)}`,
      ),
  });

  const existing = useQuery({
    queryKey: ['t-attn-marks', classSectionId, date],
    enabled: !!host && !!classSectionId && !!date,
    queryFn: () =>
      api.get<AttendanceMark[]>(
        `/manage/attendance?classSectionId=${encodeURIComponent(classSectionId)}&date=${encodeURIComponent(date)}`,
      ),
  });

  // Server marks are the source of truth whenever the class/date changes; local
  // edits layer on top until the next successful fetch.
  const [marks, setMarks] = useState<Record<string, Status>>({});
  useEffect(() => {
    if (!existing.data) return;
    setMarks(Object.fromEntries(existing.data.map((m) => [m.studentId, m.status])));
  }, [existing.data]);

  const students = useMemo(() => roster.data ?? [], [roster.data]);

  const counts = useMemo(() => {
    const tally: Record<Status, number> = { PRESENT: 0, ABSENT: 0, LATE: 0 };
    for (const s of students) tally[marks[s.id] ?? 'PRESENT'] += 1;
    return tally;
  }, [students, marks]);

  const save = useMutation({
    mutationFn: () =>
      api.put<SaveAttendanceResult>('/manage/attendance', {
        classSectionId,
        date,
        marks: students.map((s) => ({ studentId: s.id, status: marks[s.id] ?? 'PRESENT' })),
      }),
    onSuccess: (result) => {
      toast.success(
        result.absentees === 0
          ? `Attendance saved — ${result.saved} students, nobody absent.`
          : `Attendance saved — ${result.saved} students, ${result.absentees} absent. Guardians of absentees are being notified.`,
      );
      void qc.invalidateQueries({ queryKey: ['t-attn-marks', classSectionId, date] });
    },
    // The API returns a { code, message } envelope; surface message verbatim.
    onError: (e: Error) => toast.error(e.message),
  });

  const listError = (roster.error ?? existing.error) as Error | undefined;
  const listLoading = roster.isLoading || existing.isLoading;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Attendance</h1>
        <p className="text-sm text-slate-500">
          Re-saving the same day just updates statuses. Only guardians of students newly
          marked absent are emailed, so correcting a mark won&apos;t re-notify the rest.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
          <CardDescription>
            {classSectionId
              ? `${students.length} students · ${counts.PRESENT} present · ${counts.ABSENT} absent · ${counts.LATE} late`
              : 'Pick a class and a date to begin.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="attn-class">Class</Label>
              <Select
                id="attn-class"
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attn-date">Date</Label>
              <Input
                id="attn-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <Button
              disabled={!classSectionId || !date || students.length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save attendance'}
            </Button>
          </div>

          {classes.error && (
            <p className="text-sm text-rose-600">{(classes.error as Error).message}</p>
          )}
          {listError && <p className="text-sm text-rose-600">{listError.message}</p>}

          {students.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setMarks(Object.fromEntries(students.map((s) => [s.id, 'PRESENT' as Status])))
                }
              >
                Mark all present
              </Button>
            </div>
          )}

          {classSectionId && listLoading && <p className="text-sm text-slate-500">Loading roster…</p>}

          {classSectionId && !listLoading && !listError && students.length === 0 && (
            <p className="text-sm text-slate-400">
              No students in this class yet — your admin needs to enrol them.
            </p>
          )}

          {students.length > 0 && (
            <Table>
              <THead>
                <Tr>
                  <Th>Roll no.</Th>
                  <Th>Student</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {students.map((s) => {
                  const status = marks[s.id] ?? 'PRESENT';
                  return (
                    <Tr key={s.id}>
                      <Td className="text-slate-500">{s.rollNo ?? '—'}</Td>
                      <Td className="font-medium text-slate-900">
                        {s.firstName} {s.lastName}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1">
                          {STATUSES.map((option) => (
                            <button
                              key={option}
                              type="button"
                              aria-pressed={status === option}
                              onClick={() => setMarks((m) => ({ ...m, [s.id]: option }))}
                              className={
                                status === option
                                  ? 'rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white'
                                  : 'rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50'
                              }
                            >
                              {STATUS_LABEL[option]}
                            </button>
                          ))}
                          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
