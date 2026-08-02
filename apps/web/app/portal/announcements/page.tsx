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

/** A week — how long a circular stays "up" before it becomes reference. */
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a notice still counts as news.
 *
 * The pitch shows an unread slip in pinned amber and a read one dropped to the
 * plain paper treatment. `/me/announcements` carries NO per-reader read flag,
 * so "read" is a fact this page does not have and must not imply — an amber
 * slip that quietly turned plain would be asserting something untrue about
 * what the reader has seen.
 *
 * What the page does know is age, so that is what the two treatments encode
 * here, and the header copy says so in as many words. The distinction is
 * purely visual weight: every notice shows the same title, body and date
 * either way, so nothing is hidden by being old.
 */
function isFresh(iso: string, now: number = Date.now()): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t < FRESH_MS;
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
        <h1>Notice board</h1>
        <p>
          School-wide and class announcements addressed to you. This week&rsquo;s stay pinned;
          older ones settle onto the board.
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

      {/* Each circular is a slip pinned to a board: amber paper with a red pin
          bead pushed through the corner, arriving with THE PIN (`sk-pinin`) —
          dropping in slightly askew and settling square. That gesture is the
          one thing a noticeboard says that a list does not: "this went up".
          Staggered by row so a fresh batch reads as several pieces of paper
          rather than one block appearing.

          The `.sk-notice` element IS the list item, not a wrapper inside one,
          so the stylesheet's `:first-child` spacing lands on the right box. */}
      {announcements.length > 0 && (
        <ul>
          {announcements.map((ann, i) => (
            <li
              key={ann.id}
              className="sk-notice sk-pinin sk-in"
              data-fresh={isFresh(ann.createdAt)}
              style={{ animationDelay: `${Math.min(i, 8) * 0.08}s` }}
            >
              <div className="nt">{ann.title}</div>
              <div className="nd">
                {ann.classSectionId ? 'Your class' : 'Whole school'} · {formatDate(ann.createdAt)}
              </div>
              <div className="nb">{ann.body}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
