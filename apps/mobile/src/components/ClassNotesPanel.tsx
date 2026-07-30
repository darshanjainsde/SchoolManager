import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ClassNoteRow, ClassTodoRow } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card } from './ui';
import { useTokens } from '@/theme/theme-context';

interface ClassNotesData {
  notes: ClassNoteRow[];
  todos: ClassTodoRow[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export interface ClassNotesPanelProps {
  classSectionId: string;
  /** YYYY-MM-DD. */
  date: string;
  subjectId: string;
  subjectName: string;
}

/**
 * Notes and to-dos for one class, one subject, on one date. Owns its own
 * fetching and mutations — the screen only decides *when* to mount it (the
 * current period's class+subject), never how it loads or saves. Mirrors
 * apps/web/components/teacher/ClassNotes.tsx.
 *
 * `subjectId`/`subjectName` come from the caller's current timetable slot.
 * The headings always name the subject — the note is still filed against
 * one subject either way, and naming it here is what makes a 403 under
 * `SUBJECT_TEACHERS` legible rather than mysterious.
 */
export function ClassNotesPanel({ classSectionId, date, subjectId, subjectName }: ClassNotesPanelProps) {
  const tokens = useTokens();
  const inputStyle = {
    flex: 1,
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 10,
    fontSize: 13,
    color: tokens.color.ink,
  };
  const [notes, setNotes] = useState<ClassNoteRow[] | null>(null);
  const [todos, setTodos] = useState<ClassTodoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [todoBody, setTodoBody] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [addingTodo, setAddingTodo] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return api
      .request<ClassNotesData>(
        `/manage/class-notes?classSectionId=${encodeURIComponent(classSectionId)}&date=${encodeURIComponent(date)}&subjectId=${encodeURIComponent(subjectId)}`,
      )
      .then((data) => {
        setNotes(data.notes);
        setTodos(data.todos);
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      });
  }, [classSectionId, date, subjectId]);

  useEffect(() => {
    setNotes(null);
    setTodos(null);
    load();
  }, [load]);

  async function submitNote() {
    const body = noteBody.trim();
    if (!body) return;
    setNoteBody('');
    setAddingNote(true);
    try {
      await api.request('/manage/class-notes', { method: 'POST', body: { classSectionId, subjectId, date, body } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the note.');
    } finally {
      setAddingNote(false);
    }
  }

  async function submitTodo() {
    const body = todoBody.trim();
    if (!body) return;
    setTodoBody('');
    setAddingTodo(true);
    try {
      await api.request('/manage/class-todos', { method: 'POST', body: { classSectionId, subjectId, date, body } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the to-do.');
    } finally {
      setAddingTodo(false);
    }
  }

  async function toggleTodo(id: string, done: boolean) {
    try {
      await api.request(`/manage/class-todos/${id}`, { method: 'PATCH', body: { done } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the to-do.');
    }
  }

  const loading = notes === null && todos === null && !error;
  const remaining = (todos ?? []).filter((t) => !t.done).length;

  return (
    <>
      <Card testID="notes-panel">
        <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{`Notes · ${subjectName}`}</Text>
        {loading && (
          <Text style={{ color: tokens.color.sub, fontSize: 12.5, marginTop: 8 }}>Loading…</Text>
        )}
        {error && (
          <Text testID="notes-error" style={{ color: tokens.color.red, fontSize: 12.5, marginTop: 8 }}>
            {error}
          </Text>
        )}
        {!loading && !error && (notes ?? []).length === 0 && (
          <Text style={{ color: tokens.color.sub, fontSize: 12.5, marginTop: 8 }}>No notes yet.</Text>
        )}
        {!error &&
          (notes ?? []).map((n) => (
            <View key={n.id} testID={`note-${n.id}`} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: tokens.color.line }}>
              <Text style={{ fontSize: 13, color: tokens.color.ink }}>{n.body}</Text>
              <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 2 }}>{formatTime(n.createdAt)}</Text>
            </View>
          ))}
        {!error && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
            <TextInput
              testID="note-input"
              value={noteBody}
              onChangeText={setNoteBody}
              placeholder="Add a note…"
              placeholderTextColor={tokens.color.sub}
              style={inputStyle}
            />
            <Pressable
              testID="note-add"
              onPress={submitNote}
              disabled={addingNote}
              style={{ backgroundColor: tokens.color.indigo, borderRadius: 11, paddingHorizontal: 14, justifyContent: 'center', opacity: addingNote ? 0.6 : 1 }}
            >
              <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 13 }}>Add</Text>
            </Pressable>
          </View>
        )}
      </Card>

      {!error && (
        <Card testID="todos-panel">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{`To-dos · ${subjectName}`}</Text>
            {(todos ?? []).length > 0 && (
              <Text style={{ fontSize: 11, color: tokens.color.sub }}>{`${remaining} remaining`}</Text>
            )}
          </View>
          {loading && (
            <Text style={{ color: tokens.color.sub, fontSize: 12.5, marginTop: 8 }}>Loading…</Text>
          )}
          {!loading && (todos ?? []).length === 0 && (
            <Text style={{ color: tokens.color.sub, fontSize: 12.5, marginTop: 8 }}>No to-dos yet.</Text>
          )}
          {(todos ?? []).map((t) => (
            <Pressable
              key={t.id}
              testID={`todo-toggle-${t.id}`}
              onPress={() => toggleTodo(t.id, !t.done)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7 }}
            >
              <View
                testID={`todo-box-${t.id}`}
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: 5,
                  borderWidth: 1.5,
                  borderColor: t.done ? tokens.color.green : tokens.color.line,
                  backgroundColor: t.done ? tokens.color.green : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {t.done && <Text style={{ color: tokens.color.onBrand, fontSize: 11, fontWeight: '700' }}>✓</Text>}
              </View>
              <Text
                style={{
                  fontSize: 13,
                  color: t.done ? tokens.color.sub : tokens.color.ink,
                  textDecorationLine: t.done ? 'line-through' : 'none',
                  flex: 1,
                }}
              >
                {t.body}
              </Text>
            </Pressable>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
            <TextInput
              testID="todo-input"
              value={todoBody}
              onChangeText={setTodoBody}
              placeholder="Add a to-do…"
              placeholderTextColor={tokens.color.sub}
              style={inputStyle}
            />
            <Pressable
              testID="todo-add"
              onPress={submitTodo}
              disabled={addingTodo}
              style={{ backgroundColor: tokens.color.indigo, borderRadius: 11, paddingHorizontal: 14, justifyContent: 'center', opacity: addingTodo ? 0.6 : 1 }}
            >
              <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 13 }}>Add</Text>
            </Pressable>
          </View>
        </Card>
      )}
    </>
  );
}
