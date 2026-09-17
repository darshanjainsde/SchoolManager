'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import type { MeLibraryPayload } from '@/lib/library-types';
import { QueryError } from '@/components/ui/query-state';
import { LibraryView } from '@/app/portal/library/library-view';

/**
 * The teacher's shelf — the same `/me/library` payload and the same view as
 * the student's, because it IS the same object: what is out, when it is due,
 * what has been read. Fines are simply absent while the librarian keeps
 * teacher fines off (`finesEnabled` false), and the view says so in words.
 * The page owns the query and the refusal states.
 */
export default function TeacherLibraryPage() {
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
  if (shelf.error instanceof ApiError && shelf.error.status === 404) {
    // A SCHOOL_ADMIN peeking at the teacher portal has no teacher shelf.
    return (
      <p className="mx-auto max-w-md py-12 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>
        Only teacher logins have a library shelf.
      </p>
    );
  }
  // The 403/404 answers above are designed refusals. Anything else — a 500,
  // a dropped connection, an expired session — used to fall through to the
  // loading line below and sit there for good.
  if (shelf.isError) return <QueryError error={shelf.error} onRetry={shelf.refetch} className="py-10" />;
  if (shelf.isLoading || !shelf.data) {
    return <p className="py-10 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>Fetching your books…</p>;
  }
  return <LibraryView d={shelf.data} />;
}
