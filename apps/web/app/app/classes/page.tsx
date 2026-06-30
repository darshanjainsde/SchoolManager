'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Grade { id: string; name: string; sequence: number }
interface Year { id: string; name: string; isCurrent: boolean }
interface Section { id: string; name: string; capacity: number }
interface ClassRow {
  id: string;
  name: string;
  gradeId: string;
  academicYearId: string;
  grade: Grade;
  academicYear: Year;
  sections: Section[];
}

export default function ClassesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [form, setForm] = useState({ gradeId: '', academicYearId: '', name: '' });
  const [secForm, setSecForm] = useState({ classId: '', name: '', capacity: '40' });

  const grades = useQuery({ queryKey: ['grades-list'], enabled: !!host, queryFn: () => api.get<Grade[]>('/grades') });
  // No dedicated /academic-years endpoint yet — we read the years embedded in classes,
  // and infer the "current" id from the AY of any existing class. For an empty school,
  // we let the user paste the AY id manually until /academic-years lands.
  const classes = useQuery<ClassRow[]>({
    queryKey: ['classes-list'],
    enabled: !!host,
    queryFn: () => api.get<ClassRow[]>('/classes'),
  });

  const knownYears: Year[] = Array.from(
    new Map((classes.data ?? []).map((c) => [c.academicYear.id, c.academicYear])).values(),
  );

  const create = useMutation({
    mutationFn: () => api.post<ClassRow>('/classes', form),
    onSuccess: () => {
      toast.success('Class created');
      setForm({ gradeId: '', academicYearId: '', name: '' });
      qc.invalidateQueries({ queryKey: ['classes-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSection = useMutation({
    mutationFn: () =>
      api.post('/sections', {
        classId: secForm.classId,
        name: secForm.name,
        capacity: Number(secForm.capacity) || 40,
      }),
    onSuccess: () => {
      toast.success('Section added');
      setSecForm({ classId: '', name: '', capacity: '40' });
      qc.invalidateQueries({ queryKey: ['classes-list'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Classes</h1>
        <p className="text-sm text-slate-500">A class belongs to one grade in one academic year. Sections live under a class.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Add class</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_120px]">
            <div>
              <Label htmlFor="grade">Grade</Label>
              <Select id="grade" value={form.gradeId} onChange={(e) => setForm((f) => ({ ...f, gradeId: e.target.value }))}>
                <option value="">—</option>
                {(grades.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="year">Academic year</Label>
              {knownYears.length > 0 ? (
                <Select id="year" value={form.academicYearId} onChange={(e) => setForm((f) => ({ ...f, academicYearId: e.target.value }))}>
                  <option value="">—</option>
                  {knownYears.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ' (current)' : ''}</option>)}
                </Select>
              ) : (
                <Input
                  id="year"
                  placeholder="Paste academicYearId"
                  value={form.academicYearId}
                  onChange={(e) => setForm((f) => ({ ...f, academicYearId: e.target.value }))}
                />
              )}
            </div>
            <div>
              <Label htmlFor="cname">Name</Label>
              <Input id="cname" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="5-A" />
            </div>
            <div className="flex items-end">
              <Button disabled={!form.gradeId || !form.academicYearId || !form.name || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Saving…' : 'Add'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Classes ({classes.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!classes.data?.length ? (
            <div className="text-sm text-slate-500">None yet.</div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Class</Th>
                  <Th>Grade</Th>
                  <Th>Year</Th>
                  <Th>Sections</Th>
                </Tr>
              </THead>
              <TBody>
                {classes.data.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-medium">{c.name}</Td>
                    <Td>{c.grade.name}</Td>
                    <Td>{c.academicYear.name}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {c.sections.map((s) => (
                          <Badge key={s.id} tone="info">{s.name} <span className="ml-1 text-[10px] opacity-70">/{s.capacity}</span></Badge>
                        ))}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add section</CardTitle>
          <CardDescription>Sections inherit the class&apos;s grade and year.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_120px]">
            <div>
              <Label htmlFor="secClass">Class</Label>
              <Select id="secClass" value={secForm.classId} onChange={(e) => setSecForm((f) => ({ ...f, classId: e.target.value }))}>
                <option value="">—</option>
                {(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.grade.name} · {c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="secName">Section</Label>
              <Input id="secName" value={secForm.name} onChange={(e) => setSecForm((f) => ({ ...f, name: e.target.value }))} placeholder="A" />
            </div>
            <div>
              <Label htmlFor="secCap">Capacity</Label>
              <Input id="secCap" inputMode="numeric" value={secForm.capacity} onChange={(e) => setSecForm((f) => ({ ...f, capacity: e.target.value.replace(/\D/g, '') }))} />
            </div>
            <div className="flex items-end">
              <Button disabled={!secForm.classId || !secForm.name || addSection.isPending} onClick={() => addSection.mutate()}>
                {addSection.isPending ? 'Saving…' : 'Add'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
