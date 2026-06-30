'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/cn';

interface SchoolDetail {
  id: string;
  name: string;
  slug: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  timezone: string;
  createdAt: string;
  customDomains: Array<{ hostname: string; status: string; isPrimary: boolean }>;
}

interface Domain {
  id: string;
  schoolId: string;
  hostname: string;
  type: 'APEX' | 'SUBDOMAIN';
  status: 'PENDING' | 'VERIFYING' | 'LIVE' | 'ERROR';
  isPrimary: boolean;
  lastError?: string | null;
  lastCheckedAt?: string | null;
  tlsStatus?: string;
  dnsInstructions: Array<{ kind: string; name: string; value: string; ttl: number; note?: string }>;
}

interface Usage {
  schoolId: string;
  slug: string;
  users: number;
  students: number;
  teachers: number;
  customDomains: number;
  academicYears: number;
  storageBytes: number | null;
}

const STATUS_TONE: Record<Domain['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  LIVE: 'success',
  VERIFYING: 'warning',
  PENDING: 'neutral',
  ERROR: 'danger',
};

type Tab = 'branding' | 'domains' | 'usage';

export default function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('branding');

  const detail = useQuery({
    queryKey: ['school-detail', id],
    queryFn: () => api.get<SchoolDetail>(`/platform/schools/${id}`),
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{detail.data?.name ?? 'School'}</h1>
          <p className="text-sm text-slate-500">
            <code className="font-mono">{detail.data?.slug}</code> · plan {detail.data?.subscriptionPlan} · status{' '}
            <Badge tone={detail.data?.subscriptionStatus === 'ACTIVE' ? 'success' : 'warning'}>
              {detail.data?.subscriptionStatus}
            </Badge>
          </p>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-slate-200">
        {(['branding', 'domains', 'usage'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm capitalize',
              tab === t ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900',
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'branding' && <BrandingTab id={id} api={api} qc={qc} />}
      {tab === 'domains' && <DomainsTab id={id} api={api} />}
      {tab === 'usage' && <UsageTab id={id} api={api} />}
    </div>
  );
}

function BrandingTab({ id, api, qc }: { id: string; api: ReturnType<typeof useApi>; qc: ReturnType<typeof useQueryClient> }) {
  const [brandPrimary, setBrandPrimary] = useState('');
  const [aboutPage, setAboutPage] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/platform/schools/${id}/branding`, {
        brandPrimary: brandPrimary || undefined,
        aboutPage: aboutPage || undefined,
      }),
    onSuccess: () => {
      toast.success('Branding saved');
      qc.invalidateQueries({ queryKey: ['school-detail', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Updates here are applied to the tenant portal immediately.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="brandPrimary">Brand primary (hex)</Label>
          <Input id="brandPrimary" value={brandPrimary} onChange={(e) => setBrandPrimary(e.target.value)} placeholder="#0ea5e9" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="aboutPage">About page</Label>
          <Textarea id="aboutPage" rows={6} value={aboutPage} onChange={(e) => setAboutPage(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save branding'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DomainsTab({ id, api }: { id: string; api: ReturnType<typeof useApi> }) {
  const qc = useQueryClient();
  const [hostname, setHostname] = useState('');
  const [type, setType] = useState<'APEX' | 'SUBDOMAIN'>('SUBDOMAIN');

  const list = useQuery({
    queryKey: ['domains', id],
    queryFn: () => api.get<Domain[]>(`/platform/schools/${id}/domains`),
    refetchInterval: 3000,
  });

  const add = useMutation({
    mutationFn: () => api.post<Domain>(`/platform/schools/${id}/domains`, { hostname, type }),
    onSuccess: () => {
      setHostname('');
      toast.success('Domain added — verification job queued.');
      qc.invalidateQueries({ queryKey: ['domains', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verify = useMutation({
    mutationFn: (domainId: string) => api.post(`/platform/schools/${id}/domains/${domainId}/verify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', id] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const setPrimary = useMutation({
    mutationFn: (domainId: string) => api.post(`/platform/schools/${id}/domains/${domainId}/primary`),
    onSuccess: () => {
      toast.success('Set as primary');
      qc.invalidateQueries({ queryKey: ['domains', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a domain</CardTitle>
          <CardDescription>Paste the records returned below at your registrar before verifying.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-[1fr_180px_140px]">
            <div>
              <Label htmlFor="dHost">Hostname</Label>
              <Input id="dHost" value={hostname} onChange={(e) => setHostname(e.target.value.toLowerCase())} placeholder="portal.school.edu" />
            </div>
            <div>
              <Label htmlFor="dType">Type</Label>
              <Select id="dType" value={type} onChange={(e) => setType(e.target.value as 'APEX' | 'SUBDOMAIN')}>
                <option value="SUBDOMAIN">SUBDOMAIN</option>
                <option value="APEX">APEX</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => add.mutate()} disabled={!hostname || add.isPending}>Add</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Domains</CardTitle>
          <CardDescription>{list.data?.length ?? 0} attached. Status updates auto-refresh every 3 s.</CardDescription>
        </CardHeader>
        <CardContent>
          {!list.data?.length ? (
            <div className="text-sm text-slate-500">No domains yet.</div>
          ) : (
            list.data.map((d) => (
              <div key={d.id} className="mb-4 rounded border border-slate-200 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono text-sm">{d.hostname}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                      <span>{d.type}</span>
                      {d.isPrimary && <Badge tone="info">Primary</Badge>}
                      {d.tlsStatus && <span>TLS: {d.tlsStatus}</span>}
                    </div>
                    {d.lastError && <p className="mt-1 text-xs text-rose-600">{d.lastError}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => verify.mutate(d.id)}>
                      Verify
                    </Button>
                    {!d.isPrimary && (
                      <Button size="sm" variant="ghost" onClick={() => setPrimary.mutate(d.id)}>
                        Set primary
                      </Button>
                    )}
                  </div>
                </div>
                {d.dnsInstructions?.length > 0 && (
                  <div className="mt-3">
                    <Table>
                      <THead>
                        <Tr>
                          <Th>Kind</Th>
                          <Th>Name</Th>
                          <Th>Value</Th>
                          <Th>TTL</Th>
                        </Tr>
                      </THead>
                      <TBody>
                        {d.dnsInstructions.map((r, i) => (
                          <Tr key={i}>
                            <Td className="font-mono">{r.kind}</Td>
                            <Td className="font-mono">{r.name}</Td>
                            <Td className="font-mono">{r.value}</Td>
                            <Td>{r.ttl}</Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UsageTab({ id, api }: { id: string; api: ReturnType<typeof useApi> }) {
  const usage = useQuery({
    queryKey: ['usage', id],
    queryFn: () => api.get<Usage>(`/platform/schools/${id}/usage`),
  });
  if (!usage.data) return <div className="text-sm text-slate-500">Loading…</div>;
  const u = usage.data;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(['users', 'students', 'teachers', 'customDomains', 'academicYears'] as const).map((k) => (
        <Card key={k}>
          <CardHeader>
            <CardDescription className="capitalize">{k.replace(/([A-Z])/g, ' $1')}</CardDescription>
            <CardTitle className="text-3xl">{u[k]}</CardTitle>
          </CardHeader>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardDescription>Storage</CardDescription>
          <CardTitle className="text-3xl">{u.storageBytes === null ? '—' : `${u.storageBytes} B`}</CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}
