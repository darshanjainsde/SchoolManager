'use client';
import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardContent } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Announcement {
  id: string;
  title: string;
  body: string;
  classSectionId: string | null;
  createdAt: string;
}

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
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Announcements</h1>
        <p className="mt-1 text-sm text-slate-500">
          School-wide and class announcements addressed to you.
        </p>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading announcements…</p>}
      {error && (
        <p className="text-sm text-rose-500">{(error as Error).message}</p>
      )}

      {!isLoading && !error && announcements.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Megaphone className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">No announcements yet.</p>
        </div>
      )}

      {announcements.length > 0 && (
        <ul className="flex flex-col gap-3">
          {announcements.map((ann) => (
            <li key={ann.id}>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900">{ann.title}</p>
                      <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{ann.body}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {formatDate(ann.createdAt)}
                      </span>
                      {ann.classSectionId ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Class
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Whole school
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
