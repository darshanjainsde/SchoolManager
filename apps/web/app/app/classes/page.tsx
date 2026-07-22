'use client';
import { useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X, Users, Layers, Check } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ────────────────────────────────────────────────────────────────────

interface Grade {
  id: string;
  name: string;
  order?: number;
}

interface AcademicYear {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
}

interface SchoolClass {
  id: string;
  name: string;
  gradeId: string;
  academicYearId: string;
  classTeacherId?: string | null;
  grade: { name: string };
  classTeacher?: { firstName: string; lastName: string } | null;
  _count: { students: number };
}

// ── Field helper ─────────────────────────────────────────────────────────────

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label htmlFor={htmlFor} className="sk-lab">
        {label}
      </label>
      {children}
    </div>
  );
}

// Themed inputs/selects: no dedicated CSS class, styled inline, with a
// brand-colored focus ring applied directly to the DOM node on focus/blur.
const fieldStyle: CSSProperties = {
  display: 'block',
  width: '100%',
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

function classAvatarLabel(cls: SchoolClass): string {
  const digits = cls.grade.name.match(/\d+/)?.[0];
  const base = digits ?? cls.grade.name.slice(0, 2).toUpperCase();
  const section = cls.name.charAt(0).toUpperCase();
  return `${base}${section}`.slice(0, 3);
}

function classTeacherLabel(cls: SchoolClass): string {
  if (!cls.classTeacher) return 'No class teacher assigned';
  return `Class teacher: ${cls.classTeacher.firstName} ${cls.classTeacher.lastName}`;
}

// ── Add Class form ────────────────────────────────────────────────────────────

interface AddClassFormProps {
  grades: Grade[];
  years: AcademicYear[];
  teachers: Teacher[];
  onSave: (data: {
    gradeId: string;
    name: string;
    academicYearId: string;
    classTeacherId: string | null;
  }) => void;
  isSaving: boolean;
  onCancel: () => void;
}

function AddClassForm({ grades, years, teachers, onSave, isSaving, onCancel }: AddClassFormProps) {
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? '');
  const [name, setName] = useState('');
  const [academicYearId, setAcademicYearId] = useState(
    years.find((y) => y.isCurrent)?.id ?? years[0]?.id ?? '',
  );
  const [classTeacherId, setClassTeacherId] = useState('');

  const canSave = gradeId && name.trim() && academicYearId;

  return (
    <div className="sk-card" style={{ maxWidth: 560 }}>
      <div className="sk-card-h">
        <h3>Add class</h3>
      </div>
      <div className="sk-card-b">
        <Field label="Grade" htmlFor="cls-grade">
          <select
            id="cls-grade"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={gradeId}
            onChange={(e) => setGradeId(e.target.value)}
          >
            {grades.length === 0 && <option value="">No grades — add one first</option>}
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {grades.length === 0 && (
            <p className="sk-muted" style={{ margin: 0 }}>
              Add a grade on the{' '}
              <Link href="/app/classes/structure" style={{ color: 'var(--sk-brand-2)' }}>
                grades &amp; subjects
              </Link>{' '}
              page first.
            </p>
          )}
        </Field>

        <Field label="Section / name" htmlFor="cls-name">
          <input
            id="cls-name"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="A"
          />
        </Field>

        <Field label="Academic year" htmlFor="cls-year">
          <select
            id="cls-year"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={academicYearId}
            onChange={(e) => setAcademicYearId(e.target.value)}
          >
            {years.length === 0 && <option value="">No academic years found</option>}
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.isCurrent ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Class teacher (optional)" htmlFor="cls-teacher">
          <select
            id="cls-teacher"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={classTeacherId}
            onChange={(e) => setClassTeacherId(e.target.value)}
          >
            <option value="">— None —</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            className="sk-btn"
            data-variant="primary"
            onClick={() =>
              onSave({
                gradeId,
                name: name.trim(),
                academicYearId,
                classTeacherId: classTeacherId || null,
              })
            }
            disabled={isSaving || !canSave}
          >
            {isSaving ? 'Adding…' : 'Add class'}
          </button>
          <button className="sk-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ClassesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────
  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const gradesQuery = useQuery({
    queryKey: ['mng-grades'],
    queryFn: () => api.get<Grade[]>('/manage/grades'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const yearsQuery = useQuery({
    queryKey: ['mng-years'],
    queryFn: () => api.get<AcademicYear[]>('/manage/years'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const teachersQuery = useQuery({
    queryKey: ['mng-teachers'],
    queryFn: () => api.get<Teacher[]>('/manage/teachers'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addClassMutation = useMutation({
    mutationFn: (body: {
      gradeId: string;
      name: string;
      academicYearId: string;
      classTeacherId?: string | null;
    }) => api.post<SchoolClass>('/manage/classes', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-classes'] });
      setShowAdd(false);
      toast.success('Class added');
    },
    onError: (err: Error) => {
      const msg = err.message;
      toast.error(msg.includes('409') || msg.includes('duplicate') ? `Duplicate class: ${msg}` : `Failed to add class: ${msg}`);
    },
  });

  const updateClassMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.put<SchoolClass>(`/manage/classes/${id}`, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-classes'] });
      setEditId(null);
      toast.success('Class updated');
    },
    onError: (err: Error) => toast.error(`Failed to update class: ${err.message}`),
  });

  const deleteClassMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/classes/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-classes'] });
      toast.success('Class removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete class: ${err.message}`),
  });

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeleteClass(cls: SchoolClass) {
    const ok = window.confirm(`Delete class "${cls.grade.name} · ${cls.name}"? This can’t be undone.`);
    if (ok) deleteClassMutation.mutate(cls.id);
  }

  const classes = classesQuery.data ?? [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Page header */}
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Classes</h1>
          <p>Manage your school&apos;s classes by grade and section.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/app/classes/structure" className="sk-btn">
            <Layers className="h-4 w-4" />
            Manage grades &amp; subjects
          </Link>
          <button
            className="sk-btn"
            data-variant="primary"
            onClick={() => {
              setShowAdd((v) => !v);
              setEditId(null);
            }}
          >
            {showAdd ? (
              <>
                <X className="h-4 w-4" /> Cancel
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Add class
              </>
            )}
          </button>
        </div>
      </header>

      {/* Add class form */}
      {showAdd && (
        <div style={{ marginBottom: 18 }}>
          <AddClassForm
            grades={gradesQuery.data ?? []}
            years={yearsQuery.data ?? []}
            teachers={teachersQuery.data ?? []}
            onSave={(data) => addClassMutation.mutate(data)}
            isSaving={addClassMutation.isPending}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {/* Loading / error */}
      {classesQuery.isLoading && <p className="sk-state">Loading…</p>}
      {classesQuery.error && <p className="sk-state err">{(classesQuery.error as Error).message}</p>}

      {/* Empty state */}
      {!classesQuery.isLoading && classes.length === 0 && (
        <p className="sk-state">No classes yet. Add one above.</p>
      )}

      {/* Class cards grid */}
      {classes.length > 0 && (
        <div className="sk-cardgrid">
          {classes.map((cls, i) =>
            editId === cls.id ? (
              <div key={cls.id} className="sk-entity" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                <Field label="Section / name" htmlFor={`cls-edit-${cls.id}`}>
                  <input
                    id={`cls-edit-${cls.id}`}
                    style={fieldStyle}
                    onFocus={ringFocus}
                    onBlur={ringBlur}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                  />
                </Field>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="sk-btn"
                    data-variant="primary"
                    disabled={updateClassMutation.isPending || !editName.trim()}
                    onClick={() => updateClassMutation.mutate({ id: cls.id, name: editName.trim() })}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save
                  </button>
                  <button className="sk-btn" onClick={() => setEditId(null)}>
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={cls.id} className="sk-entity" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="av" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                    {classAvatarLabel(cls)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">
                      {cls.grade.name} · {cls.name}
                    </div>
                    <div className="meta">{classTeacherLabel(cls)}</div>
                  </div>
                  <span className="sk-pill" data-tone="info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Users className="h-3 w-3" />
                    {cls._count.students}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="sk-btn"
                    onClick={() => {
                      setShowAdd(false);
                      setEditId(cls.id);
                      setEditName(cls.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </button>
                  <button
                    className="sk-btn"
                    disabled={deleteClassMutation.isPending}
                    onClick={() => confirmDeleteClass(cls)}
                    style={{ color: 'var(--sk-bad)' }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}
