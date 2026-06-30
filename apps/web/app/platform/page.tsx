'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';

interface StatsResponse {
  totals: {
    schools: number;
    activeSchools: number;
    suspendedSchools: number;
    students: number;
    teachers: number;
    admins: number;
    parents: number;
    staff: number;
  };
  domains: { pendingOrError: number };
  revenue: { mrr: number | null; currency: string };
  health: { api: string; db: string };
}

const CARDS: Array<{ key: keyof StatsResponse['totals'] | 'mrr' | 'pendingDomains'; label: string }> = [
  { key: 'schools', label: 'Total schools' },
  { key: 'activeSchools', label: 'Active' },
  { key: 'suspendedSchools', label: 'Suspended' },
  { key: 'students', label: 'Students' },
  { key: 'teachers', label: 'Teachers' },
  { key: 'admins', label: 'Admins' },
  { key: 'pendingDomains', label: 'Pending domains' },
  { key: 'mrr', label: 'MRR (placeholder)' },
];

export default function PlatformDashboardPage() {
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => api.get<StatsResponse>('/platform/stats'),
    enabled: !!refreshToken,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Live platform stats. Updated on each visit.</p>
        </div>
        <Link href="/platform/onboard">
          <Button>Onboard a school</Button>
        </Link>
      </header>

      {isLoading && <div className="text-sm text-slate-500">Loading stats…</div>}
      {error && <div className="text-sm text-rose-600">{(error as Error).message}</div>}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ key, label }) => {
            const value =
              key === 'mrr'
                ? data.revenue.mrr === null
                  ? '—'
                  : `${data.revenue.currency} ${data.revenue.mrr}`
                : key === 'pendingDomains'
                ? data.domains.pendingOrError
                : (data.totals[key as keyof StatsResponse['totals']] ?? 0);
            return (
              <Card key={key}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-3xl">{value}</CardTitle>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>System health</CardTitle>
            <CardDescription>End-to-end probes from the API process.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-6 text-sm">
            <div>API: <span className="font-mono">{data.health.api}</span></div>
            <div>DB: <span className="font-mono">{data.health.db}</span></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
