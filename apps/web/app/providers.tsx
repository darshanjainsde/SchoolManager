'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';

/**
 * THE SERVER IS THE ONE TRUTH, SHARED WITH THE APP. A teacher applies for
 * leave on the phone; the office's open tab must show it. So a tab that comes
 * back into focus asks again for anything older than 30 s (refetchOnWindowFocus
 * — off here until 2026-10-15, which left an open Leave or Requests tab on its
 * morning picture all day). Editors that hold a draft (website, blog, the
 * timetable editor, settings) keep their own opt-out, named in providers.test.ts.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          // Don't retry 4xx — those are legitimately the server saying no.
          const status = (error as { status?: number })?.status ?? 0;
          if (status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

/**
 * How often a desk that people act on from their phones re-checks while it is
 * on screen (Leave, Requests, Coverage). Only while the tab is visible:
 * TanStack pauses an interval in a background tab.
 */
export const LIVE_DESK_MS = 60_000;

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
