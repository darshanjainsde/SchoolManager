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
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Announcement { id: string; title: string; body: string; audience: string; createdAt: string }

export default function TeacherAnnouncementsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: '', body: '', audience: 'CLASS' as 'SCHOOL' | 'ROLE' | 'CLASS', audienceClassId: '', audienceRole: 'STUDENT' });

  const classes = useQuery({ queryKey: ['classes-ann'], enabled: !!host, queryFn: () => api.get<Array<{ id: string; name: string; grade: { name: string } }>>('/classes') });
  const list = useQuery({ queryKey: ['announcements'], enabled: !!host, queryFn: () => api.get<Announcement[]>('/announcements') });

  const post = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { title: form.title, body: form.body, audience: form.audience };
      if (form.audience === 'CLASS') payload.audienceClassId = form.audienceClassId;
      if (form.audience === 'ROLE') payload.audienceRole = form.audienceRole;
      return api.post('/announcements', payload);
    },
    onSuccess: () => {
      toast.success('Posted');
      setForm({ title: '', body: '', audience: 'CLASS', audienceClassId: '', audienceRole: 'STUDENT' });
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header><h1 className="text-2xl font-semibold text-slate-900">Announcements</h1></header>
      <Card>
        <CardHeader><CardTitle>Post announcement</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <Label>Body</Label>
            <Textarea rows={4} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          </div>
          <div>
            <Label>Audience</Label>
            <Select value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as 'SCHOOL' | 'ROLE' | 'CLASS' }))}>
              <option value="SCHOOL">Whole school</option>
              <option value="ROLE">By role</option>
              <option value="CLASS">By class</option>
            </Select>
          </div>
          {form.audience === 'CLASS' && (
            <div>
              <Label>Class</Label>
              <Select value={form.audienceClassId} onChange={(e) => setForm((f) => ({ ...f, audienceClassId: e.target.value }))}>
                <option value="">—</option>
                {(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.grade.name} · {c.name}</option>)}
              </Select>
            </div>
          )}
          {form.audience === 'ROLE' && (
            <div>
              <Label>Role</Label>
              <Select value={form.audienceRole} onChange={(e) => setForm((f) => ({ ...f, audienceRole: e.target.value }))}>
                <option value="STUDENT">Students</option>
                <option value="PARENT">Parents</option>
                <option value="TEACHER">Teachers</option>
                <option value="STAFF">Staff</option>
              </Select>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button disabled={!form.title || !form.body || post.isPending} onClick={() => post.mutate()}>
              {post.isPending ? 'Posting…' : 'Post'}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent</CardTitle><CardDescription>{list.data?.length ?? 0}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(list.data ?? []).map((a) => (
            <div key={a.id} className="rounded border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">{a.title}</div>
                <Badge tone="info">{a.audience}</Badge>
              </div>
              <div className="mt-1 text-sm text-slate-600">{a.body}</div>
              <div className="mt-1 text-xs text-slate-400">{new Date(a.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
