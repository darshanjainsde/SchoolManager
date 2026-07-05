'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Shape returned by GET /owner/schools (Task 3 contract).
 * Declared locally — the web app cannot import API service types.
 */
interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  status: string;
  primaryDomain: string | null;
  features: string[];
}

const TIER_TONE: Record<SchoolRow['tier'], 'neutral' | 'info' | 'success'> = {
  BASIC: 'neutral',
  STANDARD: 'info',
  PRO: 'success',
};

const TIER_LABEL: Record<SchoolRow['tier'], string> = {
  BASIC: 'Basic',
  STANDARD: 'Standard',
  PRO: 'Pro',
};

export default function SchoolsListPage() {
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });

  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-schools'],
    queryFn: () => api.get<SchoolRow[]>('/owner/schools'),
    enabled: !!refreshToken,
  });

  const rows = data ?? [];

  return (
    <div className="p-8 flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Schools</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage content, features and domains per school.
          </p>
        </div>
        <Link href="/platform/onboard">
          <Button>Add School</Button>
        </Link>
      </header>

      {/* Schools table */}
      <Card>
        <CardHeader>
          <CardTitle>All schools</CardTitle>
          <CardDescription>{rows.length} school{rows.length !== 1 ? 's' : ''}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="text-sm text-slate-500">Loading…</div>
          )}
          {error && (
            <div className="text-sm text-rose-600">{(error as Error).message}</div>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <div className="text-sm text-slate-500">No schools yet — try adding one.</div>
          )}
          {!isLoading && rows.length > 0 && (
            <Table>
              <THead>
                <Tr>
                  <Th>School</Th>
                  <Th>Domain</Th>
                  <Th>Tier</Th>
                  <Th>Features</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium text-slate-900">{s.name}</Td>
                    <Td className="text-slate-500">{s.primaryDomain ?? '—'}</Td>
                    <Td>
                      <Badge tone={TIER_TONE[s.tier]}>{TIER_LABEL[s.tier]}</Badge>
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {s.features.length > 0 ? s.features.join(' · ') : '—'}
                    </Td>
                    <Td className="text-slate-700">{s.status}</Td>
                    <Td className="text-right">
                      <Link href={`/platform/schools/${s.id}`}>
                        <Button size="sm" variant="outline">Manage</Button>
                      </Link>
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
