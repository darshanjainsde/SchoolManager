'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Shape returned by GET /owner/stats (Task 2 contract).
 * Declared locally — the web app cannot import API service code.
 */
interface StatsResponse {
  schools: {
    total: number;
    byTier: {
      BASIC: number;
      STANDARD: number;
      PRO: number;
    };
    live: number;
    suspended: number;
  };
  domains: {
    live: number;
  };
}

export default function PlatformDashboardPage() {
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-stats'],
    queryFn: () => api.get<StatsResponse>('/owner/stats'),
    enabled: !!refreshToken,
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">
            Overview of every school on your platform.
          </p>
        </div>
        <Link href="/platform/onboard">
          <Button>➕ Add School</Button>
        </Link>
      </div>

      {/* Loading / error states */}
      {isLoading && (
        <div className="text-sm text-slate-500">Loading stats…</div>
      )}
      {error && (
        <div className="text-sm text-rose-600">{(error as Error).message}</div>
      )}

      {/* Stat cards */}
      {data && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Total schools */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-sm text-slate-500">Total schools</div>
            <div className="text-3xl font-bold mt-1">{data.schools.total}</div>
          </div>

          {/* By tier */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-sm text-slate-500">Basic · Standard · Pro</div>
            <div className="text-3xl font-bold mt-1">
              {data.schools.byTier.BASIC} · {data.schools.byTier.STANDARD} · {data.schools.byTier.PRO}
            </div>
          </div>

          {/* Live domains */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-sm text-slate-500">Live domains</div>
            <div className="text-3xl font-bold mt-1">{data.domains.live}</div>
          </div>

          {/* Suspended */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-sm text-slate-500">Suspended</div>
            <div
              className={`text-3xl font-bold mt-1 ${
                data.schools.suspended > 0 ? 'text-rose-600' : ''
              }`}
            >
              {data.schools.suspended}
            </div>
          </div>
        </div>
      )}

      {/* Placeholder table for recently added schools */}
      {data && (
        <div className="bg-white rounded-2xl shadow-sm mt-6">
          <div className="px-5 py-4 border-b font-semibold text-slate-900">
            Platform summary
          </div>
          <div className="px-5 py-4 text-sm text-slate-500 space-y-1">
            <div>
              <span className="font-medium text-slate-700">Live schools:</span>{' '}
              {data.schools.live}
            </div>
            <div>
              <span className="font-medium text-slate-700">Suspended:</span>{' '}
              {data.schools.suspended}
            </div>
            <div>
              <span className="font-medium text-slate-700">Live domains:</span>{' '}
              {data.domains.live}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
