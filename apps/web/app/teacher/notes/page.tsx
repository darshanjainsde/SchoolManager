'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ClassLog, ClassLogNote, ClassLogTodo, NoteClass } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

/**
 * `@Length(1, 1000)` mirrors the class-note / class-todo body limit the API
 * accepts. Enforcing it here means a teacher can't paste a wall of text, press
 * Add, and only learn it was too long from a failed round-trip — the typed
 * text still sitting in the box.
 */
const MAX_BODY = 1000;

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/** Today as `YYYY-MM-DD` in the browser's local time — the day new items are filed under. */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM-DD` `n` days before today, local time. */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Today" / "Yesterday" / a friendly date for a `YYYY-MM-DD` class day. */
function dayLabel(date: string): string {
  if (date === todayIso()) return 'Today';
  if (date === isoDaysAgo(1)) return 'Yesterday';
  // Parse the parts as a local date so a plain `YYYY-MM-DD` isn't shifted a
  // day by UTC interpretation.
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface DayGroup {
  date: string;
  notes: ClassLogNote[];
  todos: ClassLogTodo[];
}

/** Groups a class log's notes + to-dos by their filed day, newest day first. */
function groupByDay(log: ClassLog): DayGroup[] {
  const byDate = new Map<string, DayGroup>();
  const ensure = (date: string): DayGroup => {
    let g = byDate.get(date);
    if (!g) {
      g = { date, notes: [], todos: [] };
      byDate.set(date, g);
    }
    return g;
  };
  for (const n of log.notes) ensure(n.date).notes.push(n);
  for (const t of log.todos) ensure(t.date).todos.push(t);
  // `YYYY-MM-DD` sorts lexically the same as chronologically — newest first.
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

type ComposeMode = 'note' | 'todo';

export default function TeacherNotesPage(): React.JSX.Element {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  // A class has no bookmarkable identity of its own, so selection is local
  // component state — master (list) / detail (one class's history) in one page.
  const [selected, setSelected] = useState<NoteClass | null>(null);

  const classesQueryKey = ['t-note-classes'];
  const classesQuery = useQuery({
    queryKey: classesQueryKey,
    enabled: !!host,
    queryFn: () => api.get<NoteClass[]>('/manage/note-classes'),
  });
  const classes = classesQuery.data ?? [];
  const classesReady = !classesQuery.isLoading && !classesQuery.error;

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Notes &amp; to-dos</h1>
        <p>Every class you teach, its full notes and to-dos history, and a box to add more any time.</p>
      </header>

      {selected ? (
        <ClassDetail
          key={`${selected.classSectionId}:${selected.subjectId}`}
          cls={selected}
          onBack={() => setSelected(null)}
          onChanged={() => void qc.invalidateQueries({ queryKey: classesQueryKey })}
        />
      ) : (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Your classes</h3>
          </div>
          <div className="sk-card-b">
            {classesQuery.isLoading && <p className="sk-state">Loading your classes…</p>}
            {/* { code, message } envelope — surface the message verbatim. */}
            {classesQuery.error && <p className="sk-state err">{(classesQuery.error as Error).message}</p>}
            {classesReady && classes.length === 0 && (
              <p className="sk-state">No classes assigned to you yet — ask your admin.</p>
            )}
            {classesReady &&
              classes.map((c) => (
                <button
                  type="button"
                  key={`${c.classSectionId}:${c.subjectId}`}
                  className="sk-row sk-press"
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
                  onClick={() => setSelected(c)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">
                      {c.className} · {c.subjectName}
                    </div>
                    <div className="meta">
                      {c.noteCount} note{c.noteCount === 1 ? '' : 's'} · {c.openTodoCount} open to-do
                      {c.openTodoCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className="sp" />
                  <span className="sk-pill" data-tone={c.isClassTeacher ? 'good' : 'info'}>
                    {c.isClassTeacher ? 'Class teacher' : 'Subject teacher'}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The detail view for one class+subject: its grouped history, plus the composer. */
function ClassDetail({
  cls,
  onBack,
  onChanged,
}: {
  cls: NoteClass;
  onBack: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const logQueryKey = ['t-class-log', cls.classSectionId, cls.subjectId];
  const logQuery = useQuery({
    queryKey: logQueryKey,
    enabled: !!host,
    queryFn: () =>
      api.get<ClassLog>(
        `/manage/class-log?classSectionId=${encodeURIComponent(cls.classSectionId)}&subjectId=${encodeURIComponent(cls.subjectId)}`,
      ),
  });

  const groups = useMemo(() => (logQuery.data ? groupByDay(logQuery.data) : []), [logQuery.data]);
  const isEmpty = !logQuery.isLoading && !logQuery.error && groups.length === 0;

  function refresh() {
    void qc.invalidateQueries({ queryKey: logQueryKey });
    onChanged();
  }

  // ── Composer ──────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ComposeMode>('note');
  const [body, setBody] = useState('');
  const trimmed = body.trim();

  const add = useMutation({
    mutationFn: () => {
      const payload = {
        classSectionId: cls.classSectionId,
        subjectId: cls.subjectId,
        date: todayIso(),
        body: trimmed,
      };
      return api.post(mode === 'note' ? '/manage/class-notes' : '/manage/class-todos', payload);
    },
    onSuccess: () => {
      toast.success(mode === 'note' ? 'Note added' : 'To-do added');
      setBody('');
      refresh();
    },
    // { code, message } envelope — surface message verbatim.
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTodo = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.patch(`/manage/class-todos/${id}`, { done }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  function switchMode(next: ComposeMode) {
    if (next === mode) return;
    setMode(next);
    setBody('');
  }

  return (
    <>
      <div>
        <button type="button" className="sk-btn sk-press" onClick={onBack}>
          ← All classes
        </button>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>
            {cls.className} · {cls.subjectName}
          </h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            {cls.isClassTeacher ? 'Class teacher' : 'Subject teacher'}
          </p>
        </div>
        <div className="sk-card-b">
          {/* Composer — the segmented Note / To-do toggle. */}
          <div role="group" aria-label="What to add" className="sk-wrap-sm" style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="sk-chip"
              aria-pressed={mode === 'note'}
              onClick={() => switchMode('note')}
              disabled={add.isPending}
            >
              📌 Note
            </button>
            <button
              type="button"
              className="sk-chip"
              aria-pressed={mode === 'todo'}
              onClick={() => switchMode('todo')}
              disabled={add.isPending}
            >
              ✓ To-do
            </button>
          </div>
          <p className="sk-muted">
            {mode === 'note'
              ? 'Note = something to remember'
              : 'To-do = something to do — tick it off'}
          </p>

          {mode === 'note' ? (
            <Textarea
              aria-label="New note"
              rows={4}
              className={`${fieldCls} w-full`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={add.isPending}
              maxLength={MAX_BODY}
              placeholder={`Write a note for ${cls.className}…`}
            />
          ) : (
            <Input
              aria-label="New to-do"
              className={`${fieldCls} w-full`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={add.isPending}
              maxLength={MAX_BODY}
              placeholder={`Add a task for ${cls.className}…`}
            />
          )}

          <div>
            <button
              type="button"
              className="sk-btn sk-press"
              data-variant="primary"
              disabled={trimmed.length === 0 || add.isPending}
              onClick={() => add.mutate()}
            >
              {add.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>History</h3>
        </div>
        <div className="sk-card-b">
          {logQuery.isLoading && <p className="sk-state">Loading…</p>}
          {logQuery.error && <p className="sk-state err">{(logQuery.error as Error).message}</p>}
          {isEmpty && <p className="sk-state">Nothing here yet — add your first note or to-do above.</p>}

          {groups.map((g) => (
            <section key={g.date} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="sk-lab">{dayLabel(g.date)}</div>
              {/* A note is a `.sk-row`: pin glyph, then the body. The diary's
                  own `.sk-diary-item` sets its own padding, rule and text size,
                  so mixing it in here put two different row rhythms — notes and
                  to-dos — inside one dated group. */}
              {g.notes.map((n) => (
                <div className="sk-row" key={n.id}>
                  <span aria-hidden="true">📌</span>
                  <div className="nm" style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' }}>
                    {n.body}
                  </div>
                </div>
              ))}
              {/* The native checkbox, shown. `.sk-todo input[type="checkbox"]`
                  already sizes it (16px, brand accent, flex:none); the drawn
                  tick replaced that with an absolutely-positioned `opacity: 0`
                  input inside a 15px box, which overrode the themed rule from
                  the markup and made the real control invisible. */}
              {g.todos.map((t) => (
                <label className={`sk-todo${t.done ? ' done' : ''}`} key={t.id}>
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={toggleTodo.isPending}
                    onChange={(e) => toggleTodo.mutate({ id: t.id, done: e.target.checked })}
                  />
                  <span>{t.body}</span>
                </label>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
