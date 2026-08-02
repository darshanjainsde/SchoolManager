'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronDown, Paperclip } from 'lucide-react';
import type { StudentAssignment, StudentAssignmentList } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

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

/**
 * NO TICK BOX HERE, DELIBERATELY.
 *
 * A design pass put a green ticked checkbox on every row in the "Past"
 * section. `StudentAssignment` carries no submission field — the API has never
 * been asked whether this student handed anything in, and `/me/assignments`
 * splits `upcoming`/`past` purely on the due date. A filled green tick beside a
 * piece of homework reads as "handed in" to anyone who does not stop and read
 * the small print, and the family that stops reading is the family whose work
 * is still on the kitchen table.
 *
 * The section heading already says "Past", and the row says the due date in
 * words. That is the whole of what this page actually knows. If a submission
 * field ever lands, a tick becomes honest and can come back.
 */
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
    <div className="sk-card">
      <div className="sk-card-b">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--sk-ink)]">{assignment.title}</p>
            <p className="text-sm text-[var(--sk-ink-2)]">{assignment.subjectName}</p>
            <p className="mt-0.5 text-xs text-[var(--sk-ink-3)]">
              Due {formatDueDate(assignment.dueDate)}
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-[var(--sk-ink-3)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        {isOpen && (
          <div className="mt-3 border-t border-[var(--sk-line)] pt-3">
            <p className="whitespace-pre-wrap text-sm text-[var(--sk-ink-2)]">{assignment.instructions}</p>
            {assignment.attachments.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {assignment.attachments.map((a) => (
                  <li key={a.url}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-[var(--sk-brand-2)] underline"
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
      </div>
    </div>
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
      <header className="sk-pagehead">
        <h1>Assignments</h1>
        <p>Homework set for your class, newest due date first.</p>
      </header>

      {isLoading && <p className="sk-state">Loading assignments…</p>}
      {error && <p className="sk-state err">{(error as Error).message}</p>}

      {!isLoading && !error && upcoming.length === 0 && past.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <BookOpen className="h-10 w-10 text-[var(--sk-ink-3)]" />
          <p className="sk-state">No assignments yet.</p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="sk-lab">Upcoming</h2>
          {upcoming.map((a) => (
            <AssignmentRow key={a.id} assignment={a} isOpen={openIds.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="sk-lab">Past</h2>
          {past.map((a) => (
            <AssignmentRow key={a.id} assignment={a} isOpen={openIds.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </section>
      )}
    </div>
  );
}
