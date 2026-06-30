'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface ClassRow { id: string; name: string; grade: { name: string } }
interface Subject { id: string; code: string; name: string }
interface Assignment {
  id: string; title: string; description?: string; dueAt: string; maxPoints: number;
  classId: string; subjectId: string; subject?: { code: string; name: string };
}

export default function TeacherAssignmentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [form, setForm] = useState({ classId: '', subjectId: '', title: '', description: '', dueAt: '', maxPoints: '100' });

  const classes = useQuery({ queryKey: ['classes-assign'], enabled: !!host, queryFn: () => api.get<ClassRow[]>('/classes') });
  const subjects = useQuery({ queryKey: ['subjects-assign'], enabled: !!host, queryFn: () => api.get<Subject[]>('/subjects') });
  const list = useQuery({
    queryKey: ['assignments', form.classId],
    enabled: !!host,
    queryFn: () => api.get<Assignment[]>(form.classId ? `/assignments?classId=${form.classId}` : '/assignments'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/assignments', {
        classId: form.classId,
        subjectId: form.subjectId,
        title: form.title,
        description: form.description || undefined,
        dueAt: new Date(form.dueAt).toISOString(),
        maxPoints: Number(form.maxPoints) || 100,
      }),
    onSuccess: () => {
      toast.success('Assignment posted');
      setForm({ classId: '', subjectId: '', title: '', description: '', dueAt: '', maxPoints: '100' });
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Assignments</h1>
        <p className="text-sm text-slate-500">Post work for a class. Students submit from /me.</p>
      </header>
      <Card>
        <CardHeader><CardTitle>New assignment</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Class</Label>
              <Select value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
                <option value="">—</option>
                {(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.grade.name} · {c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Subject</Label>
              <Select value={form.subjectId} onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}>
                <option value="">—</option>
                {(subjects.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Textarea rows={4} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Due</Label>
              <Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))} />
            </div>
            <div>
              <Label>Max points</Label>
              <Input inputMode="numeric" value={form.maxPoints} onChange={(e) => setForm((f) => ({ ...f, maxPoints: e.target.value.replace(/\D/g, '') }))} />
            </div>
            <div className="sm:col-span-2">
              <Button
                disabled={!form.classId || !form.subjectId || !form.title || !form.dueAt || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Posting…' : 'Post'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Existing</CardTitle><CardDescription>{list.data?.length ?? 0}</CardDescription></CardHeader>
        <CardContent>
          {!list.data?.length ? <div className="text-sm text-slate-500">None yet.</div> : (
            <Table>
              <THead>
                <Tr><Th>Title</Th><Th>Subject</Th><Th>Due</Th><Th>Max</Th></Tr>
              </THead>
              <TBody>
                {list.data.map((a) => (
                  <Tr key={a.id}>
                    <Td className="font-medium">{a.title}</Td>
                    <Td>{a.subject?.code ?? a.subjectId.slice(0, 8)}</Td>
                    <Td><Badge tone={new Date(a.dueAt) < new Date() ? 'danger' : 'info'}>{new Date(a.dueAt).toLocaleString()}</Badge></Td>
                    <Td>{a.maxPoints}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
