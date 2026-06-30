'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Grade {
  id: string;
  name: string;
  sequence: number;
  isActive: boolean;
}

export default function GradesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [sequence, setSequence] = useState('');

  const list = useQuery({
    queryKey: ['grades-page'],
    enabled: !!host,
    queryFn: () => api.get<Grade[]>('/grades'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<Grade>('/grades', { name, sequence: Number(sequence) }),
    onSuccess: () => {
      toast.success('Grade created');
      setName(''); setSequence('');
      qc.invalidateQueries({ queryKey: ['grades-page'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/grades/${id}`),
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['grades-page'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Grades</h1>
        <p className="text-sm text-slate-500">Top-level academic grouping. Sequence drives sort order.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Add grade</CardTitle>
          <CardDescription>Name must be unique within the school.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px]">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Grade 5" />
            </div>
            <div>
              <Label htmlFor="seq">Sequence</Label>
              <Input id="seq" inputMode="numeric" value={sequence} onChange={(e) => setSequence(e.target.value.replace(/\D/g, ''))} placeholder="5" />
            </div>
            <div className="flex items-end">
              <Button disabled={!name || !sequence || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Saving…' : 'Add grade'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grades ({list.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : !list.data?.length ? (
            <div className="text-sm text-slate-500">None yet.</div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Sequence</Th>
                  <Th>Active</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.map((g) => (
                  <Tr key={g.id}>
                    <Td className="font-medium">{g.name}</Td>
                    <Td>{g.sequence}</Td>
                    <Td>{g.isActive ? 'yes' : 'no'}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="destructive" onClick={() => remove.mutate(g.id)} disabled={remove.isPending}>
                        Delete
                      </Button>
                    </Td>
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
