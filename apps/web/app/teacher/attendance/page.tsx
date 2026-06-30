'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
const STATUSES: Status[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

interface ClassRow { id: string; name: string; grade: { name: string }; sections: Array<{ id: string; name: string }> }
interface Enrollment {
  id: string; studentUserId: string; classId: string; sectionId?: string | null;
}
interface AttendanceRow { enrollmentId: string; status: Status; note?: string | null }

const todayIso = () => new Date().toISOString().slice(0, 10);

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
  const [classId, setClassId] = useState(params.get('classId') ?? '');
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(todayIso());

  const classes = useQuery({ queryKey: ['t-attn-classes'], enabled: !!host, queryFn: () => api.get<ClassRow[]>('/classes') });
  const enrollments = useQuery({
    queryKey: ['t-enrolls', classId],
    enabled: !!host && !!classId,
    queryFn: () => api.get<Enrollment[]>(`/enrollments?classId=${classId}`),
  });
  const existing = useQuery({
    queryKey: ['t-att-list', classId, date],
    enabled: !!host && !!classId && !!date,
    queryFn: () => api.get<AttendanceRow[]>(`/attendance?classId=${classId}&date=${date}`),
  });

  const [marks, setMarks] = useState<Record<string, Status>>({});
  useEffect(() => {
    if (!existing.data) return;
    setMarks(Object.fromEntries(existing.data.map((r) => [r.enrollmentId, r.status])));
  }, [existing.data]);

  const selectedClass = classes.data?.find((c) => c.id === classId);

  const save = useMutation({
    mutationFn: () => {
      const filteredEnrolls = (enrollments.data ?? []).filter(
        (e) => !sectionId || e.sectionId === sectionId,
      );
      const list = filteredEnrolls.map((e) => ({
        enrollmentId: e.id,
        status: marks[e.id] ?? 'PRESENT',
      }));
      return api.post('/attendance/bulk', { classId, sectionId: sectionId || undefined, date, marks: list });
    },
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['t-att-list', classId, date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(
    () => (enrollments.data ?? []).filter((e) => !sectionId || e.sectionId === sectionId),
    [enrollments.data, sectionId],
  );

  function setAll(status: Status) {
    setMarks(Object.fromEntries(filtered.map((e) => [e.id, status])));
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Attendance</h1>
        <p className="text-sm text-slate-500">Bulk-save is idempotent: re-saving the same day just updates statuses.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
          <CardDescription>{filtered.length} students</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto]">
            <div>
              <Select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
                <option value="">Pick a class…</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.grade.name} · {c.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!selectedClass}>
                <option value="">All sections</option>
                {(selectedClass?.sections ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Button disabled={!classId || filtered.length === 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {filtered.length > 0 && (
            <div className="flex gap-2">
              {STATUSES.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => setAll(s)}>
                  Mark all {s.toLowerCase()}
                </Button>
              ))}
            </div>
          )}
          {filtered.length > 0 ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Student</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {filtered.map((e) => {
                  const status = marks[e.id] ?? 'PRESENT';
                  return (
                    <Tr key={e.id}>
                      <Td className="font-mono text-xs">{e.studentUserId.slice(0, 8)}…</Td>
                      <Td>
                        <div className="flex gap-1">
                          {STATUSES.map((s) => (
                            <button
                              key={s}
                              onClick={() => setMarks((m) => ({ ...m, [e.id]: s }))}
                              className={
                                status === s
                                  ? 'rounded bg-slate-900 px-2 py-0.5 text-xs text-white'
                                  : 'rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50'
                              }
                            >
                              {s[0]}
                            </button>
                          ))}
                          <Badge tone={status === 'PRESENT' ? 'success' : status === 'ABSENT' ? 'danger' : status === 'LATE' ? 'warning' : 'neutral'}>
                            {status}
                          </Badge>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <div className="text-sm text-slate-500">Pick a class to load the roster.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
