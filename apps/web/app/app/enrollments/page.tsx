'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface ClassRow {
  id: string;
  name: string;
  grade: { name: string };
  academicYear: { id: string; name: string; isCurrent: boolean };
  sections: Array<{ id: string; name: string }>;
}
interface UserRow { id: string; email: string; role: string; firstName: string; lastName: string }
interface EnrollmentRow {
  id: string;
  studentUserId: string;
  status: 'ACTIVE' | 'TRANSFERRED' | 'GRADUATED' | 'WITHDRAWN';
  enrolledAt: string;
  class: { id: string; name: string; grade: { name: string } };
  section?: { id: string; name: string } | null;
  academicYear: { name: string };
}

export default function EnrollmentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [form, setForm] = useState({ studentUserId: '', classId: '', sectionId: '', academicYearId: '' });

  const classes = useQuery({ queryKey: ['classes-enrl'], enabled: !!host, queryFn: () => api.get<ClassRow[]>('/classes') });
  const users = useQuery({ queryKey: ['users-enrl'], enabled: !!host, queryFn: () => api.get<UserRow[]>('/users') });
  const list = useQuery({ queryKey: ['enrollments'], enabled: !!host, queryFn: () => api.get<EnrollmentRow[]>('/enrollments') });

  const selectedClass = classes.data?.find((c) => c.id === form.classId);
  const students = (users.data ?? []).filter((u) => u.role === 'STUDENT');

  const enroll = useMutation({
    mutationFn: () =>
      api.post('/enrollments', {
        studentUserId: form.studentUserId,
        classId: form.classId,
        sectionId: form.sectionId || undefined,
        academicYearId: selectedClass?.academicYear.id ?? form.academicYearId,
      }),
    onSuccess: () => {
      toast.success('Enrolled');
      setForm({ studentUserId: '', classId: '', sectionId: '', academicYearId: '' });
      qc.invalidateQueries({ queryKey: ['enrollments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transition = useMutation({
    mutationFn: (vars: { id: string; status: 'TRANSFERRED' | 'GRADUATED' | 'WITHDRAWN' }) =>
      api.patch(`/enrollments/${vars.id}/transition`, { status: vars.status }),
    onSuccess: () => {
      toast.success('Updated');
      qc.invalidateQueries({ queryKey: ['enrollments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Enrollments</h1>
        <p className="text-sm text-slate-500">One ACTIVE row per student per academic year.</p>
      </header>

      <Card>
        <CardHeader><CardTitle>Enroll a student</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_140px]">
            <div>
              <Label htmlFor="student">Student</Label>
              <Select id="student" value={form.studentUserId} onChange={(e) => setForm((f) => ({ ...f, studentUserId: e.target.value }))}>
                <option value="">—</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.firstName} {s.lastName} &lt;{s.email}&gt;</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="cls">Class</Label>
              <Select id="cls" value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value, sectionId: '' }))}>
                <option value="">—</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.grade.name} · {c.name} ({c.academicYear.name})</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="sec">Section (optional)</Label>
              <Select id="sec" value={form.sectionId} onChange={(e) => setForm((f) => ({ ...f, sectionId: e.target.value }))}>
                <option value="">—</option>
                {(selectedClass?.sections ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </Select>
            </div>
            <div className="flex items-end">
              <Button disabled={!form.studentUserId || !form.classId || enroll.isPending} onClick={() => enroll.mutate()}>
                {enroll.isPending ? 'Saving…' : 'Enroll'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Enrollments ({list.data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {!list.data?.length ? (
            <div className="text-sm text-slate-500">None yet.</div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Student</Th>
                  <Th>Class</Th>
                  <Th>Section</Th>
                  <Th>Year</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.map((e) => {
                  const stu = students.find((s) => s.id === e.studentUserId);
                  return (
                    <Tr key={e.id}>
                      <Td className="font-medium">{stu ? `${stu.firstName} ${stu.lastName}` : e.studentUserId}</Td>
                      <Td>{e.class.grade.name} · {e.class.name}</Td>
                      <Td>{e.section?.name ?? '—'}</Td>
                      <Td>{e.academicYear.name}</Td>
                      <Td>
                        <Badge tone={e.status === 'ACTIVE' ? 'success' : e.status === 'WITHDRAWN' ? 'danger' : 'neutral'}>
                          {e.status}
                        </Badge>
                      </Td>
                      <Td className="space-x-2 text-right">
                        {e.status === 'ACTIVE' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => transition.mutate({ id: e.id, status: 'TRANSFERRED' })}>Transfer</Button>
                            <Button size="sm" variant="outline" onClick={() => transition.mutate({ id: e.id, status: 'GRADUATED' })}>Graduate</Button>
                            <Button size="sm" variant="destructive" onClick={() => transition.mutate({ id: e.id, status: 'WITHDRAWN' })}>Withdraw</Button>
                          </>
                        )}
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
