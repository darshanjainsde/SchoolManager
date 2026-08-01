'use client';
import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import type { Announcement } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalAnnouncementsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-announcements'],
    queryFn: () => api.get<Announcement[]>('/me/announcements'),
    enabled: !!host,
    staleTime: 60_000,
  });

  const announcements = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Announcements</h1>
        <p>
          School-wide and class announcements addressed to you.
        </p>
      </header>

      {isLoading && <p className="sk-state">Loading announcements…</p>}
      {error && (
        <p className="sk-state err">{(error as Error).message}</p>
      )}

      {!isLoading && !error && announcements.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Megaphone className="h-10 w-10 text-[var(--sk-ink-3)]" />
          <p className="sk-state">No announcements yet.</p>
        </div>
      )}

      {announcements.length > 0 && (
        <ul className="flex flex-col gap-3">
          {announcements.map((ann) => (
            <li key={ann.id}>
              <div className="sk-card">
                <div className="sk-card-b">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[var(--sk-ink)]">{ann.title}</p>
                      <p className="mt-1 text-sm text-[var(--sk-ink-2)] whitespace-pre-wrap">{ann.body}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <span className="text-xs text-[var(--sk-ink-3)] whitespace-nowrap">
                        {formatDate(ann.createdAt)}
                      </span>
                      {ann.classSectionId ? (
                        <span className="sk-pill" data-tone="info">
                          Class
                        </span>
                      ) : (
                        <span className="sk-pill" data-tone="neutral">
                          Whole school
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
