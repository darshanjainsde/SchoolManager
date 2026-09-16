'use client';

/**
 * What a screen shows while a request is in flight, and when it failed.
 *
 * This exists because `if (q.isLoading || !q.data) return <Loading/>` was
 * written twelve times across the console, and that condition is ALSO true on
 * every failure: on a 404, a 500, a dropped connection or an expired session,
 * `data` is undefined and `isLoading` is false, so the screen sits on its
 * loading message forever. A school reported one of them — the year-end
 * wizard's "Adding it up…" — as "very very slow". It was not slow. It was
 * finished and broken, and the screen was the only thing that did not know.
 *
 * `useQueryState` collapses the three cases a query actually has, so the
 * error one cannot be forgotten by writing the condition slightly wrong.
 */
import type { ReactNode } from 'react';

export interface QueryLike {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: unknown;
  refetch?: () => unknown;
}

/** The standard failure block: what went wrong, and a way to try again. */
export function QueryError({ error, onRetry, className }: { error: unknown; onRetry?: () => unknown; className?: string }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className={className ?? 'sk-card-b'} role="alert">
      <p className="sk-state err">{message}</p>
      {onRetry && (
        <button type="button" className="sk-btn sk-press" style={{ marginTop: 10 }} onClick={() => void onRetry()}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Returns the node to render INSTEAD of the screen, or null to carry on.
 *
 *   const gate = useQueryState(q, 'Loading the fee grid…');
 *   if (gate) return gate;
 *   // q.data is present from here
 *
 * Error is checked BEFORE loading on purpose: a query that failed and is being
 * retried is both, and the honest thing to show is the failure.
 */
export function useQueryState(q: QueryLike, loading: ReactNode, className?: string): ReactNode | null {
  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className={className} />;
  if (q.isLoading || q.data === undefined || q.data === null) {
    return <div className={className ?? 'sk-card-b'}><p className="sk-muted">{loading}</p></div>;
  }
  return null;
}
