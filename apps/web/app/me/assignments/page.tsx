'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Submission {
  id: string; assignmentId: string; submittedAt: string; isLate: boolean;
  grade?: number | null; feedback?: string | null;
  assignment: { title: string; dueAt: string };
}
interface Me { userId: string; role: string }

export default function MyAssignmentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [, setMe] = useState<Me | undefined>();
  const [picked, setPicked] = useState<string | null>(null);
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!host) return;
    api.get<Me>('/auth/me').then(setMe).catch(() => undefined);
  }, [host, api]);

  const list = useQuery({
    queryKey: ['my-submissions'],
    enabled: !!host,
    queryFn: () => api.get<Submission[]>('/me/submissions'),
  });
  const assignments = useQuery({
    queryKey: ['avail-assignments'],
    enabled: !!host,
    queryFn: () => api.get<Array<{ id: string; title: string; dueAt: string }>>('/assignments'),
  });

  const submit = useMutation({
    mutationFn: () => api.post(`/assignments/${picked}/submit`, { body }),
    onSuccess: () => {
      toast.success('Submitted');
      setBody(''); setPicked(null);
      qc.invalidateQueries({ queryKey: ['my-submissions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Assignments</h1>
        <p className="text-sm text-slate-500">Submit work and check grades.</p>
      </header>

      <Card>
        <CardHeader><CardTitle>Available</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(assignments.data ?? []).map((a) => (
            <button
              key={a.id}
              onClick={() => setPicked(a.id)}
              className={`rounded border p-3 text-left ${picked === a.id ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-200 hover:border-slate-400'}`}
            >
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-slate-500">Due {new Date(a.dueAt).toLocaleString()}</div>
            </button>
          ))}
        </CardContent>
      </Card>

      {picked && (
        <Card>
          <CardHeader><CardTitle>Submit</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <Label>Your work</Label>
              <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <Button disabled={!body || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? 'Submitting…' : 'Submit'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>My submissions</CardTitle>
          <CardDescription>{list.data?.length ?? 0}</CardDescription>
        </CardHeader>
        <CardContent>
          {!list.data?.length ? <div className="text-sm text-slate-500">Nothing submitted yet.</div> : (
            <Table>
              <THead><Tr><Th>Assignment</Th><Th>Submitted</Th><Th>Grade</Th><Th>Feedback</Th></Tr></THead>
              <TBody>
                {list.data.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium">{s.assignment.title}{s.isLate && <Badge tone="warning" className="ml-2">Late</Badge>}</Td>
                    <Td>{new Date(s.submittedAt).toLocaleString()}</Td>
                    <Td>{s.grade !== null && s.grade !== undefined ? s.grade : '—'}</Td>
                    <Td className="max-w-[280px] truncate">{s.feedback ?? '—'}</Td>
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
