'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClassNoteRow, ClassTodoRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface ClassNotesData {
  notes: ClassNoteRow[];
  todos: ClassTodoRow[];
}

const fieldCls =
  'flex-1 rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Notes and to-dos for one class on one date. Owns its own queries and
 * mutations — the page only decides *when* to mount it (the current
 * period's class), never how it fetches or saves.
 */
export function ClassNotes({ classSectionId, date }: { classSectionId: string; date: string }): React.JSX.Element {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [noteBody, setNoteBody] = useState('');
  const [todoBody, setTodoBody] = useState('');

  const queryKey = ['class-notes', classSectionId, date];

  const query = useQuery({
    queryKey,
    enabled: !!host && !!classSectionId && !!date,
    queryFn: () =>
      api.get<ClassNotesData>(
        `/manage/class-notes?classSectionId=${encodeURIComponent(classSectionId)}&date=${encodeURIComponent(date)}`,
      ),
  });

  const addNote = useMutation({
    mutationFn: (body: string) => api.post('/manage/class-notes', { classSectionId, date, body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  });

  const addTodo = useMutation({
    mutationFn: (body: string) => api.post('/manage/class-todos', { classSectionId, date, body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  });

  const setTodoDone = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.patch(`/manage/class-todos/${id}`, { done }),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  });

  const notes = query.data?.notes ?? [];
  const todos = query.data?.todos ?? [];
  const remaining = todos.filter((t) => !t.done).length;
  const error = query.error as Error | undefined;

  function submitNote(e: React.FormEvent) {
    e.preventDefault();
    const body = noteBody.trim();
    if (!body) return;
    setNoteBody('');
    addNote.mutate(body);
  }

  function submitTodo(e: React.FormEvent) {
    e.preventDefault();
    const body = todoBody.trim();
    if (!body) return;
    setTodoBody('');
    addTodo.mutate(body);
  }

  return (
    <div className="sk-grid2">
      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Notes</h3>
        </div>
        <div className="sk-card-b">
          {query.isLoading && <p className="sk-state">Loading…</p>}
          {error && <p className="sk-state err">{error.message}</p>}
          {!query.isLoading && !error && notes.length === 0 && <p className="sk-state">No notes yet.</p>}
          {notes.map((n) => (
            <div className="sk-row" key={n.id}>
              <div style={{ minWidth: 0 }}>
                <div className="nm">{n.body}</div>
                <div className="meta">{formatTime(n.createdAt)}</div>
              </div>
            </div>
          ))}
          <form onSubmit={submitNote} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              className={fieldCls}
              placeholder="Add a note…"
              aria-label="Add a note"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
            />
            <button type="submit" className="sk-btn" disabled={addNote.isPending}>
              Add
            </button>
          </form>
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>To-dos</h3>
          {todos.length > 0 && <p className="sk-muted" style={{ marginTop: 4 }}>{remaining} remaining</p>}
        </div>
        <div className="sk-card-b">
          {query.isLoading && <p className="sk-state">Loading…</p>}
          {error && <p className="sk-state err">{error.message}</p>}
          {!query.isLoading && !error && todos.length === 0 && <p className="sk-state">No to-dos yet.</p>}
          {todos.map((t) => (
            <label className={`sk-todo${t.done ? ' done' : ''}`} key={t.id}>
              <input
                type="checkbox"
                checked={t.done}
                onChange={(e) => setTodoDone.mutate({ id: t.id, done: e.target.checked })}
              />
              <span>{t.body}</span>
            </label>
          ))}
          <form onSubmit={submitTodo} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              className={fieldCls}
              placeholder="Add a to-do…"
              aria-label="Add a to-do"
              value={todoBody}
              onChange={(e) => setTodoBody(e.target.value)}
            />
            <button type="submit" className="sk-btn" disabled={addTodo.isPending}>
              Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
