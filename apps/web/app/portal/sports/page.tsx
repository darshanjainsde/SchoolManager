'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import type { MeSportsPayload } from '@/lib/sports-me-types';
import { QueryError } from '@/components/ui/query-state';
import { SportsView } from './sports-view';

/** The page owns the query and the refusal states; `SportsView` owns the layout (child and teacher). */
export default function PortalSportsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({ queryKey: ['me-sports', host], enabled: !!host, retry: false, queryFn: () => api.get<MeSportsPayload>('/me/sports') });

  if (q.error instanceof ApiError && q.error.status === 403) {
    return (
      <p className="mx-auto max-w-md py-12 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>
        Sports isn&rsquo;t part of your school&rsquo;s plan yet.
      </p>
    );
  }
  // The 403 answer above is a designed refusal. Anything else — a 500, a
  // dropped connection, an expired session — used to fall through to the
  // loading line below and sit there for good.
  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-10" />;
  if (q.isLoading || !q.data) return <p className="py-10 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>Checking the day board…</p>;
  return <SportsView d={q.data} />;
}
