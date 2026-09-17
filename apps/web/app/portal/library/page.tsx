'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import type { MeLibraryPayload } from '@/lib/library-types';
import { QueryError } from '@/components/ui/query-state';
import { LibraryView } from './library-view';

/** The page owns the query and the three refusal states; `LibraryView` owns the layout. */
export default function PortalLibraryPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const shelf = useQuery({
    queryKey: ['me-library', host],
    enabled: !!host,
    retry: false,
    queryFn: () => api.get<MeLibraryPayload>('/me/library'),
  });

  if (shelf.error instanceof ApiError && shelf.error.status === 403) {
    return (
      <p className="mx-auto max-w-md py-12 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>
        The library isn&rsquo;t part of your school&rsquo;s plan yet.
      </p>
    );
  }
  // The 403 answer above is a designed refusal. Anything else — a 500, a
  // dropped connection, an expired session — used to fall through to the
  // loading line below and sit there for good.
  if (shelf.isError) return <QueryError error={shelf.error} onRetry={shelf.refetch} className="py-10" />;
  if (shelf.isLoading || !shelf.data) {
    return <p className="py-10 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>Fetching your books…</p>;
  }
  return <LibraryView d={shelf.data} />;
}
