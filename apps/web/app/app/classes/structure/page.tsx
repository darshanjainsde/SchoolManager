'use client';
import { useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, X, ArrowLeft } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ────────────────────────────────────────────────────────────────────

interface Grade {
  id: string;
  name: string;
  order?: number;
}

interface Subject {
  id: string;
  name: string;
  code?: string | null;
}

// Themed inputs: no dedicated CSS class, styled inline, with a brand-colored
// focus ring applied directly to the DOM node on focus/blur.
const fieldStyle: CSSProperties = {
  display: 'block',
  border: '1px solid var(--sk-line-2)',
  borderRadius: 10,
  padding: '9px 11px',
  background: 'var(--sk-card)',
  color: 'var(--sk-ink)',
  fontSize: 13.5,
  fontFamily: 'inherit',
  transition: 'border-color 0.12s, box-shadow 0.12s',
};

function ringFocus(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-brand)';
  e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--sk-brand) 18%, transparent)';
}

function ringBlur(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-line-2)';
  e.currentTarget.style.boxShadow = 'none';
}

// ── Inline add-one input ──────────────────────────────────────────────────────

interface InlineAddProps {
  placeholder: string;
  buttonLabel: string;
  isSaving: boolean;
  onSave: (value: string) => void;
  extraField?: {
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
  };
}

function InlineAdd({ placeholder, buttonLabel, isSaving, onSave, extraField }: InlineAddProps) {
  const [value, setValue] = useState('');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        style={{ ...fieldStyle, maxWidth: 200, flex: '1 1 160px' }}
        onFocus={ringFocus}
        onBlur={ringBlur}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onSave(value.trim());
            setValue('');
          }
        }}
      />
      {extraField && (
        <input
          style={{ ...fieldStyle, maxWidth: 120 }}
          onFocus={ringFocus}
          onBlur={ringBlur}
          value={extraField.value}
          onChange={(e) => extraField.onChange(e.target.value)}
          placeholder={extraField.placeholder}
        />
      )}
      <button
        className="sk-btn"
        data-variant="primary"
        disabled={isSaving || !value.trim()}
        onClick={() => {
          onSave(value.trim());
          setValue('');
        }}
      >
        <Plus className="h-4 w-4" />
        {buttonLabel}
      </button>
    </div>
  );
}

// ── Delete-able list row ─────────────────────────────────────────────────────

function EntryRow({
  label,
  onDelete,
  isDeleting,
  deleteLabel,
}: {
  label: ReactNode;
  onDelete: () => void;
  isDeleting: boolean;
  deleteLabel: string;
}) {
  return (
    <div className="sk-row">
      <span style={{ flex: 1, fontSize: 13.5, color: 'var(--sk-ink)' }}>{label}</span>
      <button
        onClick={onDelete}
        disabled={isDeleting}
        aria-label={deleteLabel}
        className="sk-btn"
        style={{ color: 'var(--sk-bad)', padding: '6px 9px' }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ClassesStructurePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const [newSubjectCode, setNewSubjectCode] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────
  const gradesQuery = useQuery({
    queryKey: ['mng-grades'],
    queryFn: () => api.get<Grade[]>('/manage/grades'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const subjectsQuery = useQuery({
    queryKey: ['mng-subjects'],
    queryFn: () => api.get<Subject[]>('/manage/subjects'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addGradeMutation = useMutation({
    mutationFn: (name: string) =>
      api.post<Grade>('/manage/grades', {
        name,
        order: (gradesQuery.data?.length ?? 0) + 1,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-grades'] });
      toast.success('Grade added');
    },
    onError: (err: Error) => toast.error(`Failed to add grade: ${err.message}`),
  });

  const addSubjectMutation = useMutation({
    mutationFn: ({ name, code }: { name: string; code?: string }) =>
      api.post<Subject>('/manage/subjects', { name, code: code || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-subjects'] });
      setNewSubjectCode('');
      toast.success('Subject added');
    },
    onError: (err: Error) => toast.error(`Failed to add subject: ${err.message}`),
  });

  const deleteGradeMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/grades/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-grades'] });
      toast.success('Grade removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete grade: ${err.message}`),
  });

  const deleteSubjectMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/subjects/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-subjects'] });
      toast.success('Subject removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete subject: ${err.message}`),
  });

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeleteGrade(grade: Grade) {
    const ok = window.confirm(`Delete grade "${grade.name}"? This can’t be undone.`);
    if (ok) deleteGradeMutation.mutate(grade.id);
  }

  function confirmDeleteSubject(subject: Subject) {
    const ok = window.confirm(`Delete subject "${subject.name}"? This can’t be undone.`);
    if (ok) deleteSubjectMutation.mutate(subject.id);
  }

  const grades = gradesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Page header */}
      <header className="sk-pagehead">
        <Link
          href="/app/classes"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--sk-ink-3)',
            textDecoration: 'none',
            marginBottom: 8,
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Classes
        </Link>
        <h1>Grades &amp; subjects</h1>
        <p>Grades are required before you can create classes. Subjects can be assigned to teachers.</p>
      </header>

      <div className="sk-grid2">
        {/* ── Grades ─────────────────────────────────────────────────────── */}
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Grades</h3>
          </div>
          <div className="sk-card-b">
            <InlineAdd
              placeholder="e.g. Grade 1"
              buttonLabel="Add grade"
              isSaving={addGradeMutation.isPending}
              onSave={(name) => addGradeMutation.mutate(name)}
            />

            {gradesQuery.isLoading && <p className="sk-state">Loading grades…</p>}
            {gradesQuery.error && <p className="sk-state err">{(gradesQuery.error as Error).message}</p>}
            {!gradesQuery.isLoading && grades.length === 0 && (
              <p className="sk-state">No grades yet.</p>
            )}
            {grades.length > 0 && (
              <div>
                {grades.map((g) => (
                  <EntryRow
                    key={g.id}
                    label={g.name}
                    onDelete={() => confirmDeleteGrade(g)}
                    isDeleting={deleteGradeMutation.isPending}
                    deleteLabel={`Remove grade ${g.name}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Subjects ───────────────────────────────────────────────────── */}
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Subjects</h3>
          </div>
          <div className="sk-card-b">
            <InlineAdd
              placeholder="e.g. Mathematics"
              buttonLabel="Add subject"
              isSaving={addSubjectMutation.isPending}
              onSave={(name) => addSubjectMutation.mutate({ name, code: newSubjectCode })}
              extraField={{
                placeholder: 'Code (opt.)',
                value: newSubjectCode,
                onChange: setNewSubjectCode,
              }}
            />

            {subjectsQuery.isLoading && <p className="sk-state">Loading subjects…</p>}
            {subjectsQuery.error && <p className="sk-state err">{(subjectsQuery.error as Error).message}</p>}
            {!subjectsQuery.isLoading && subjects.length === 0 && (
              <p className="sk-state">No subjects yet.</p>
            )}
            {subjects.length > 0 && (
              <div>
                {subjects.map((s) => (
                  <EntryRow
                    key={s.id}
                    label={
                      <>
                        {s.name}
                        {s.code && <span className="sk-muted" style={{ marginLeft: 8 }}>({s.code})</span>}
                      </>
                    }
                    onDelete={() => confirmDeleteSubject(s)}
                    isDeleting={deleteSubjectMutation.isPending}
                    deleteLabel={`Remove subject ${s.name}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
