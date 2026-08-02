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
 * THE TICK — a real stroke, drawn on, rather than a green icon that was always
 * there. `sk-tick`/`sk-in` come from sk-theme.css, which also collapses it to
 * the finished stroke under `prefers-reduced-motion: reduce`.
 */
function DrawnTick(): React.JSX.Element {
  return (
    <svg
      className="sk-tick sk-in"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 12.5 L10 18 L20 6" />
    </svg>
  );
}

function AssignmentRow({
  assignment,
  isOpen,
  onToggle,
  duePassed,
}: {
  assignment: StudentAssignment;
  isOpen: boolean;
  onToggle: () => void;
  /**
   * WHAT THE TICK IS ALLOWED TO MEAN.
   *
   * `StudentAssignment` carries no submission field — the API has never been
   * asked whether this student handed anything in, and `/me/assignments`
   * splits `upcoming`/`past` purely on the due date. So the tick here means
   * exactly one thing: THE DUE DATE HAS PASSED. It must never be read as
   * "handed in", "done" or "accepted", because the portal has no idea.
   *
   * That is why the row says "Due date passed" in words next to the tick
   * rather than letting a green stroke imply completion on its own, and why
   * nothing on this page is styled as struck-through: a family reading a tick
   * as "submitted" when the work is still on the kitchen table is the one
   * misunderstanding this page could cause that would actually cost someone
   * something. If a submission field ever lands, this prop is the only thing
   * that needs to change.
   */
  duePassed: boolean;
}) {
  return (
    <div className="sk-card">
      <div className="sk-card-b">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex w-full items-start gap-3 text-left"
        >
          <span className="sk-tickbox mt-0.5" data-done={duePassed} aria-hidden="true">
            {duePassed && <DrawnTick />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--sk-ink)]">{assignment.title}</p>
            <p className="text-sm text-[var(--sk-ink-2)]">{assignment.subjectName}</p>
            <p className="mt-0.5 text-xs text-[var(--sk-ink-3)]">
              Due {formatDueDate(assignment.dueDate)}
              {duePassed && ' · due date passed'}
            </p>
          </div>
          <ChevronDown
            className={`mt-1 h-4 w-4 shrink-0 text-[var(--sk-ink-3)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
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
            <AssignmentRow
              key={a.id}
              assignment={a}
              isOpen={openIds.has(a.id)}
              onToggle={() => toggle(a.id)}
              duePassed={false}
            />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="sk-lab">Past</h2>
          {/* Spelled out once, above the ticked rows, so the tick can never be
              read as a claim about what was handed in — see the `duePassed`
              note on AssignmentRow. */}
          <p className="sk-state" style={{ padding: 0 }}>
            The tick means the due date has gone by — not that anything was handed in.
          </p>
          {past.map((a) => (
            <AssignmentRow
              key={a.id}
              assignment={a}
              isOpen={openIds.has(a.id)}
              onToggle={() => toggle(a.id)}
              duePassed
            />
          ))}
        </section>
      )}
    </div>
  );
}
