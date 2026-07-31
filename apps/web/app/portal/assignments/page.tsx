'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronDown, Paperclip } from 'lucide-react';
import type { StudentAssignment, StudentAssignmentList } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardContent } from '@/components/ui/card';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * `StudentAssignment.dueDate` (`@db.Date`, `YYYY-MM-DD`) is a plain calendar
 * date — read with `timeZone: 'UTC'` so it never rolls back a day in a
 * negative-UTC-offset browser. Mirrors `formatDueDate` in
 * apps/web/app/teacher/assignments/page.tsx.
 */
function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ── Row ───────────────────────────────────────────────────────────────────────

function AssignmentRow({
  assignment,
  isOpen,
  onToggle,
}: {
  assignment: StudentAssignment;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{assignment.title}</p>
            <p className="text-sm text-slate-600">{assignment.subjectName}</p>
            <p className="mt-0.5 text-xs text-slate-400">Due {formatDueDate(assignment.dueDate)}</p>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        {isOpen && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="whitespace-pre-wrap text-sm text-slate-700">{assignment.instructions}</p>
            {assignment.attachments.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {assignment.attachments.map((a) => (
                  <li key={a.url}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-teal-700 underline"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {a.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalAssignmentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-assignments'],
    queryFn: () => api.get<StudentAssignmentList>('/me/assignments'),
    enabled: !!host,
    staleTime: 30_000,
  });

  const markSeen = useMutation({
    mutationFn: (id: string) => api.post(`/me/assignments/${id}/seen`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal-assignments'] }),
  });

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  // `POST /me/assignments/:id/seen` is idempotent server-side, but this ref
  // still stops a second call within the SAME visit — opening, closing and
  // re-opening a card should fire the request once, not once per toggle.
  const seenSentRef = useRef<Set<string>>(new Set());

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (!seenSentRef.current.has(id)) {
          seenSentRef.current.add(id);
          markSeen.mutate(id);
        }
      }
      return next;
    });
  }

  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Assignments</h1>
        <p className="mt-1 text-sm text-slate-500">Homework set for your class, newest due date first.</p>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading assignments…</p>}
      {error && <p className="text-sm text-rose-500">{(error as Error).message}</p>}

      {!isLoading && !error && upcoming.length === 0 && past.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <BookOpen className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-400">No assignments yet.</p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Upcoming</h2>
          {upcoming.map((a) => (
            <AssignmentRow key={a.id} assignment={a} isOpen={openIds.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Past</h2>
          {past.map((a) => (
            <AssignmentRow key={a.id} assignment={a} isOpen={openIds.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </section>
      )}
    </div>
  );
}
