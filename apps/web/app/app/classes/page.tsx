'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X, Users } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

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

interface Subject {
  id: string;
  name: string;
  code?: string | null;
}

// ── Add Class Modal ───────────────────────────────────────────────────────────

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

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Add class</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cls-grade">Grade</Label>
          <Select
            id="cls-grade"
            value={gradeId}
            onChange={(e) => setGradeId(e.target.value)}
          >
            {grades.length === 0 && <option value="">No grades — add one below</option>}
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cls-name">Section / name</Label>
          <Input
            id="cls-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="A"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cls-year">Academic year</Label>
          <Select
            id="cls-year"
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
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cls-teacher">Class teacher (optional)</Label>
          <Select
            id="cls-teacher"
            value={classTeacherId}
            onChange={(e) => setClassTeacherId(e.target.value)}
          >
            <option value="">— None —</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </option>
            ))}
          </Select>
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          onClick={() =>
            onSave({
              gradeId,
              name: name.trim(),
              academicYearId,
              classTeacherId: classTeacherId || null,
            })
          }
          disabled={isSaving || !gradeId || !name.trim() || !academicYearId}
        >
          {isSaving ? 'Adding…' : 'Add class'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
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
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="max-w-[160px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onSave(value.trim());
            setValue('');
          }
        }}
      />
      {extraField && (
        <Input
          value={extraField.value}
          onChange={(e) => extraField.onChange(e.target.value)}
          placeholder={extraField.placeholder}
          className="max-w-[100px]"
        />
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={isSaving || !value.trim()}
        onClick={() => {
          onSave(value.trim());
          setValue('');
        }}
      >
        <Plus className="h-4 w-4 mr-1" />
        {buttonLabel}
      </Button>
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
  const [newSubjectCode, setNewSubjectCode] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────
  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const gradesQuery = useQuery({
    queryKey: ['mng-grades'],
    queryFn: () => api.get<Grade[]>('/manage/grades'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const yearsQuery = useQuery({
    queryKey: ['mng-years'],
    queryFn: () => api.get<AcademicYear[]>('/manage/years'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const teachersQuery = useQuery({
    queryKey: ['mng-teachers'],
    queryFn: () => api.get<Teacher[]>('/manage/teachers'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const subjectsQuery = useQuery({
    queryKey: ['mng-subjects'],
    queryFn: () => api.get<Subject[]>('/manage/subjects'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Classes</h1>
          <p className="mt-1 text-sm text-slate-500">Manage your school&apos;s classes by grade and section.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setShowAdd((v) => !v);
            setEditId(null);
          }}
        >
          {showAdd ? (
            <>
              <X className="h-4 w-4 mr-1" /> Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1" /> Add class
            </>
          )}
        </Button>
      </header>

      {/* Add class form */}
      {showAdd && (
        <AddClassForm
          grades={gradesQuery.data ?? []}
          years={yearsQuery.data ?? []}
          teachers={teachersQuery.data ?? []}
          onSave={(data) => addClassMutation.mutate(data)}
          isSaving={addClassMutation.isPending}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Loading / error */}
      {classesQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {classesQuery.error && (
        <p className="text-sm text-rose-600">{(classesQuery.error as Error).message}</p>
      )}

      {/* Empty state */}
      {!classesQuery.isLoading && (classesQuery.data?.length ?? 0) === 0 && (
        <p className="text-sm text-slate-400">No classes yet. Add one above.</p>
      )}

      {/* Class cards grid */}
      {(classesQuery.data?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {classesQuery.data!.map((cls) => (
            <Card key={cls.id}>
              <CardHeader className="pb-2">
                {editId === cls.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      disabled={updateClassMutation.isPending || !editName.trim()}
                      onClick={() => updateClassMutation.mutate({ id: cls.id, name: editName.trim() })}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <CardTitle className="text-base">
                    {cls.grade.name} &mdash; {cls.name}
                  </CardTitle>
                )}
              </CardHeader>
              <CardContent className="space-y-1 pb-2">
                {cls.classTeacher ? (
                  <p className="text-sm text-slate-600">
                    Class teacher: {cls.classTeacher.firstName} {cls.classTeacher.lastName}
                  </p>
                ) : (
                  <p className="text-sm text-slate-400 italic">No class teacher assigned</p>
                )}
                <div className="flex items-center gap-1.5 text-sm text-slate-500">
                  <Users className="h-3.5 w-3.5" />
                  <span>{cls._count.students} student{cls._count.students !== 1 ? 's' : ''}</span>
                </div>
              </CardContent>
              <CardFooter className="gap-2 pt-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowAdd(false);
                    setEditId(cls.id);
                    setEditName(cls.name);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteClassMutation.isPending}
                  onClick={() => deleteClassMutation.mutate(cls.id)}
                  className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* ── Grades management ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Grades</h2>
          <p className="text-sm text-slate-500">Grades are required before you can create classes.</p>
        </div>

        <InlineAdd
          placeholder="e.g. Grade 1"
          buttonLabel="Add grade"
          isSaving={addGradeMutation.isPending}
          onSave={(name) => addGradeMutation.mutate(name)}
        />

        {gradesQuery.isLoading && <p className="text-sm text-slate-500">Loading grades…</p>}
        {(gradesQuery.data?.length ?? 0) > 0 && (
          <ul className="space-y-1">
            {gradesQuery.data!.map((g) => (
              <li key={g.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-slate-700">{g.name}</span>
                <button
                  onClick={() => deleteGradeMutation.mutate(g.id)}
                  disabled={deleteGradeMutation.isPending}
                  className="text-slate-400 hover:text-rose-500 disabled:opacity-50"
                  aria-label={`Remove grade ${g.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!gradesQuery.isLoading && (gradesQuery.data?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-400">No grades yet.</p>
        )}
      </section>

      {/* ── Subjects management ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Subjects</h2>
          <p className="text-sm text-slate-500">Subjects can be assigned to teachers.</p>
        </div>

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

        {subjectsQuery.isLoading && <p className="text-sm text-slate-500">Loading subjects…</p>}
        {(subjectsQuery.data?.length ?? 0) > 0 && (
          <ul className="space-y-1">
            {subjectsQuery.data!.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-slate-700">
                  {s.name}
                  {s.code && <span className="ml-2 text-slate-400">({s.code})</span>}
                </span>
                <button
                  onClick={() => deleteSubjectMutation.mutate(s.id)}
                  disabled={deleteSubjectMutation.isPending}
                  className="text-slate-400 hover:text-rose-500 disabled:opacity-50"
                  aria-label={`Remove subject ${s.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!subjectsQuery.isLoading && (subjectsQuery.data?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-400">No subjects yet.</p>
        )}
      </section>
    </div>
  );
}
