'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/use-api';

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED';
  createdAt: string;
}

const STATUS_TONE: Record<SchoolRow['subscriptionStatus'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELED: 'neutral',
  SUSPENDED: 'danger',
};

export default function SchoolsListPage() {
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['platform-schools'],
    queryFn: () => api.get<SchoolRow[]>('/platform/schools'),
  });

  const suspend = useMutation({
    mutationFn: (id: string) => api.post(`/platform/schools/${id}/suspend`),
    onSuccess: () => {
      toast.success('School suspended');
      qc.invalidateQueries({ queryKey: ['platform-schools'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const unsuspend = useMutation({
    mutationFn: (id: string) => api.post(`/platform/schools/${id}/unsuspend`),
    onSuccess: () => {
      toast.success('School unsuspended');
      qc.invalidateQueries({ queryKey: ['platform-schools'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const impersonate = useMutation({
    mutationFn: (id: string) =>
      api.post<{ accessToken: string; expiresIn: number }>(`/platform/schools/${id}/impersonate`),
    onSuccess: (data, _id) => {
      navigator.clipboard?.writeText(data.accessToken).catch(() => undefined);
      toast.success('Impersonation token copied to clipboard (15-min TTL).');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resend = useMutation({
    mutationFn: (id: string) =>
      api.post<{ resent: boolean; throttled: boolean }>(`/platform/schools/${id}/invite/resend`),
    onSuccess: (data) => {
      if (data.throttled) toast.info('Already sent recently — try again in 24h.');
      else toast.success('Invite re-emailed.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (data ?? []).filter(
    (s) => !filter || s.slug.includes(filter.toLowerCase()) || s.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Schools</h1>
          <p className="text-sm text-slate-500">Every tenant on the platform.</p>
        </div>
        <Link href="/platform/onboard">
          <Button>Onboard a school</Button>
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>All schools</CardTitle>
          <CardDescription>{rows.length} of {data?.length ?? 0}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              placeholder="Filter by name or slug…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-slate-500">No schools yet — try onboarding one.</div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Slug</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium text-slate-900">
                      <Link href={`/platform/schools/${s.id}`} className="hover:underline">
                        {s.name}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{s.slug}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[s.subscriptionStatus]}>{s.subscriptionStatus}</Badge>
                    </Td>
                    <Td className="text-xs text-slate-500">{new Date(s.createdAt).toLocaleDateString()}</Td>
                    <Td className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => impersonate.mutate(s.id)} disabled={impersonate.isPending}>
                        Impersonate
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => resend.mutate(s.id)} disabled={resend.isPending}>
                        Resend invite
                      </Button>
                      {s.subscriptionStatus === 'SUSPENDED' ? (
                        <Button size="sm" variant="secondary" onClick={() => unsuspend.mutate(s.id)}>
                          Unsuspend
                        </Button>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => suspend.mutate(s.id)}>
                          Suspend
                        </Button>
                      )}
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
