'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Subject { id: string; code: string; name: string; isElective: boolean }

export default function SubjectsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: '', name: '', isElective: false });

  const list = useQuery({ queryKey: ['subjects-list'], enabled: !!host, queryFn: () => api.get<Subject[]>('/subjects') });

  const create = useMutation({
    mutationFn: () => api.post<Subject>('/subjects', { ...form, code: form.code.toUpperCase() }),
    onSuccess: () => {
      toast.success('Subject created');
      setForm({ code: '', name: '', isElective: false });
      qc.invalidateQueries({ queryKey: ['subjects-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/subjects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subjects-list'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Subjects</h1>
        <p className="text-sm text-slate-500">Codes are uppercase letters/digits/dashes, unique per school.</p>
      </header>

      <Card>
        <CardHeader><CardTitle>Add subject</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr_140px_120px]">
            <div>
              <Label htmlFor="code">Code</Label>
              <Input id="code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="MATH" />
            </div>
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Mathematics" />
            </div>
            <div className="flex items-end gap-2">
              <input
                id="elective"
                type="checkbox"
                checked={form.isElective}
                onChange={(e) => setForm((f) => ({ ...f, isElective: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="elective">Elective</Label>
            </div>
            <div className="flex items-end">
              <Button disabled={!form.code || !form.name || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Saving…' : 'Add'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Subjects ({list.data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {!list.data?.length ? (
            <div className="text-sm text-slate-500">None yet.</div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-mono text-xs">{s.code}</Td>
                    <Td className="font-medium">{s.name}</Td>
                    <Td>{s.isElective ? 'Elective' : 'Core'}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="destructive" onClick={() => remove.mutate(s.id)} disabled={remove.isPending}>
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
