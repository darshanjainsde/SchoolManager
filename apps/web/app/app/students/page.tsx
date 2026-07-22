'use client';
import { useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X, KeyRound, CheckCircle2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ────────────────────────────────────────────────────────────────────

interface SchoolClass {
  id: string;
  name: string;
  grade: { name: string };
}

interface Student {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  classSectionId: string | null;
  rollNo: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  classSection: { name: string; grade: { name: string } } | null;
  userId: string | null;
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

// ── Create Login Modal ────────────────────────────────────────────────────────

interface LoginCredentials {
  email: string;
  tempPassword: string;
}

function CreateLoginModal({ credentials, onClose }: { credentials: LoginCredentials; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 30, 24, 0.5)',
        padding: 16,
      }}
    >
      <div className="sk-card" style={{ width: '100%', maxWidth: 380 }}>
        <div className="sk-card-h">
          <h3>Login created — save these now</h3>
        </div>
        <div className="sk-card-b">
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              color: 'var(--sk-amber)',
              background: 'var(--sk-amber-tint)',
              borderRadius: 10,
              padding: '10px 12px',
            }}
          >
            The temporary password is shown only once. Save it before closing this dialog.
          </p>
          <Field label="Email" htmlFor="cl-email">
            <input
              id="cl-email"
              readOnly
              value={credentials.email}
              style={{ ...fieldStyle, fontFamily: 'monospace', fontSize: 13 }}
              onFocus={ringFocus}
              onBlur={ringBlur}
            />
          </Field>
          <Field label="Temporary password" htmlFor="cl-pw">
            <input
              id="cl-pw"
              readOnly
              value={credentials.tempPassword}
              style={{ ...fieldStyle, fontFamily: 'monospace', fontSize: 13 }}
              onFocus={ringFocus}
              onBlur={ringBlur}
            />
          </Field>
          <button className="sk-btn" data-variant="primary" onClick={onClose}>
            I&apos;ve saved these — close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Student Form (Add / Edit) ────────────────────────────────────────────────

interface StudentFormData {
  firstName: string;
  lastName: string;
  admissionNo: string;
  rollNo: string;
  classSectionId: string;
  guardianName: string;
  guardianPhone: string;
}

interface StudentFormProps {
  title: string;
  initial?: Partial<StudentFormData>;
  classes: SchoolClass[];
  onSave: (data: StudentFormData) => void;
  isSaving: boolean;
  onCancel: () => void;
}

function StudentForm({ title, initial = {}, classes, onSave, isSaving, onCancel }: StudentFormProps) {
  const [firstName, setFirstName] = useState(initial.firstName ?? '');
  const [lastName, setLastName] = useState(initial.lastName ?? '');
  const [admissionNo, setAdmissionNo] = useState(initial.admissionNo ?? '');
  const [rollNo, setRollNo] = useState(initial.rollNo ?? '');
  const [classSectionId, setClassSectionId] = useState(initial.classSectionId ?? '');
  const [guardianName, setGuardianName] = useState(initial.guardianName ?? '');
  const [guardianPhone, setGuardianPhone] = useState(initial.guardianPhone ?? '');

  const canSave = firstName.trim() && lastName.trim() && admissionNo.trim();

  return (
    <div className="sk-card" style={{ maxWidth: 560 }}>
      <div className="sk-card-h">
        <h3>{title}</h3>
      </div>
      <div className="sk-card-b">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="First name" htmlFor="sf-first">
            <input
              id="sf-first"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
            />
          </Field>
          <Field label="Last name" htmlFor="sf-last">
            <input
              id="sf-last"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Admission no." htmlFor="sf-admission">
            <input
              id="sf-admission"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={admissionNo}
              onChange={(e) => setAdmissionNo(e.target.value)}
              placeholder="ADM-001"
            />
          </Field>
          <Field label="Roll no. (optional)" htmlFor="sf-roll">
            <input
              id="sf-roll"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={rollNo}
              onChange={(e) => setRollNo(e.target.value)}
              placeholder="1"
            />
          </Field>
        </div>

        <Field label="Class (optional)" htmlFor="sf-class">
          <select
            id="sf-class"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={classSectionId}
            onChange={(e) => setClassSectionId(e.target.value)}
          >
            <option value="">— Unassigned —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.grade.name} — {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Guardian name (optional)" htmlFor="sf-guardian-name">
            <input
              id="sf-guardian-name"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
              placeholder="John Doe"
            />
          </Field>
          <Field label="Guardian phone (optional)" htmlFor="sf-guardian-phone">
            <input
              id="sf-guardian-phone"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={guardianPhone}
              onChange={(e) => setGuardianPhone(e.target.value)}
              placeholder="+1 555 0100"
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            className="sk-btn"
            data-variant="primary"
            onClick={() =>
              onSave({
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                admissionNo: admissionNo.trim(),
                rollNo: rollNo.trim(),
                classSectionId,
                guardianName: guardianName.trim(),
                guardianPhone: guardianPhone.trim(),
              })
            }
            disabled={isSaving || !canSave}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button className="sk-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function classBadgeLabel(student: Student): string | null {
  if (!student.classSection) return null;
  return `${student.classSection.grade.name} — ${student.classSection.name}`;
}

function apiErrorMessage(err: Error): string {
  return err.message;
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '11px 14px',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--sk-ink-3)',
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  padding: '11px 14px',
  fontSize: 13,
  borderTop: '1px solid var(--sk-line)',
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StudentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState('');
  const [loginCredentials, setLoginCredentials] = useState<LoginCredentials | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const studentsQuery = useQuery({
    queryKey: ['mng-students', classFilter],
    queryFn: () => {
      const qs = classFilter ? `?classSectionId=${encodeURIComponent(classFilter)}` : '';
      return api.get<Student[]>(`/manage/students${qs}`);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (data: StudentFormData) => {
      const body: Record<string, string | undefined> = {
        firstName: data.firstName,
        lastName: data.lastName,
        admissionNo: data.admissionNo,
        rollNo: data.rollNo || undefined,
        classSectionId: data.classSectionId || undefined,
        guardianName: data.guardianName || undefined,
        guardianPhone: data.guardianPhone || undefined,
      };
      return api.post<Student>('/manage/students', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      setShowAdd(false);
      toast.success('Student added');
    },
    onError: (err: Error) => {
      const msg = apiErrorMessage(err);
      if (msg.includes('409') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already')) {
        toast.error(`Duplicate admission no.: ${msg}`);
      } else if (msg.includes('400') || msg.toLowerCase().includes('class')) {
        toast.error(`Invalid class: ${msg}`);
      } else {
        toast.error(`Failed to add student: ${msg}`);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: StudentFormData }) => {
      const body: Record<string, string | undefined> = {
        firstName: data.firstName,
        lastName: data.lastName,
        admissionNo: data.admissionNo,
        rollNo: data.rollNo || undefined,
        classSectionId: data.classSectionId || undefined,
        guardianName: data.guardianName || undefined,
        guardianPhone: data.guardianPhone || undefined,
      };
      return api.put<Student>(`/manage/students/${id}`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      setEditId(null);
      toast.success('Student updated');
    },
    onError: (err: Error) => {
      const msg = apiErrorMessage(err);
      if (msg.includes('409') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already')) {
        toast.error(`Duplicate admission no.: ${msg}`);
      } else if (msg.includes('400') || msg.toLowerCase().includes('class')) {
        toast.error(`Invalid class: ${msg}`);
      } else {
        toast.error(`Failed to update student: ${msg}`);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/students/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      toast.success('Student removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete student: ${err.message}`),
  });

  const createLoginMutation = useMutation({
    mutationFn: (studentId: string) =>
      api.post<LoginCredentials>(`/manage/students/${studentId}/login`, {}),
    onSuccess: (credentials) => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      setLoginCredentials(credentials);
    },
    onError: (err: Error) => {
      const msg = err.message;
      if (msg.includes('409') || msg.toLowerCase().includes('already')) {
        toast.error('This student already has a login.');
      } else {
        toast.error(`Failed to create login: ${msg}`);
      }
    },
  });

  // Derive the initial values for the edit form from current student data
  const editingStudent = editId ? (studentsQuery.data ?? []).find((s) => s.id === editId) : null;

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeleteStudent(student: Student) {
    const ok = window.confirm(`Remove ${student.firstName} ${student.lastName}? This can’t be undone.`);
    if (ok) deleteMutation.mutate(student.id);
  }

  const students = studentsQuery.data ?? [];
  const unassignedCount = students.filter((s) => !s.classSectionId).length;
  const loginCount = students.filter((s) => s.userId).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Create Login credentials modal */}
      {loginCredentials && (
        <CreateLoginModal
          credentials={loginCredentials}
          onClose={() => setLoginCredentials(null)}
        />
      )}

      {/* Page header */}
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Students</h1>
          <p>Manage enrolled students.</p>
        </div>
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
              <Plus className="h-4 w-4" /> Add student
            </>
          )}
        </button>
      </header>

      {students.length > 0 && (
        <div className="sk-kpis" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <div className="sk-kpi">
            <span className="lab">Students shown</span>
            <span className="n">{students.length}</span>
            {classFilter && <span className="hint">Filtered by class</span>}
          </div>
          <div className="sk-kpi" data-tone={unassignedCount > 0 ? 'warn' : undefined}>
            <span className="lab">Without a class</span>
            <span className="n">{unassignedCount}</span>
          </div>
          <div className="sk-kpi" data-tone="good">
            <span className="lab">Portal logins</span>
            <span className="n">{loginCount}</span>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div style={{ marginBottom: 18 }}>
          <StudentForm
            title="Add student"
            classes={classesQuery.data ?? []}
            onSave={(data) => addMutation.mutate(data)}
            isSaving={addMutation.isPending}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {/* Edit form */}
      {editId && editingStudent && (
        <div style={{ marginBottom: 18 }}>
          <StudentForm
            title="Edit student"
            initial={{
              firstName: editingStudent.firstName,
              lastName: editingStudent.lastName,
              admissionNo: editingStudent.admissionNo,
              rollNo: editingStudent.rollNo ?? '',
              classSectionId: editingStudent.classSectionId ?? '',
              guardianName: editingStudent.guardianName ?? '',
              guardianPhone: editingStudent.guardianPhone ?? '',
            }}
            classes={classesQuery.data ?? []}
            onSave={(data) => updateMutation.mutate({ id: editId, data })}
            isSaving={updateMutation.isPending}
            onCancel={() => setEditId(null)}
          />
        </div>
      )}

      {/* Class filter */}
      <div className="sk-card" style={{ marginBottom: 18, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <label htmlFor="class-filter" className="sk-lab" style={{ flex: 'none' }}>
          Filter by class
        </label>
        <select
          id="class-filter"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          style={{ ...fieldStyle, maxWidth: 260 }}
          onFocus={ringFocus}
          onBlur={ringBlur}
        >
          <option value="">All classes</option>
          {(classesQuery.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.grade.name} — {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Loading / error */}
      {studentsQuery.isLoading && <p className="sk-state">Loading…</p>}
      {studentsQuery.error && <p className="sk-state err">{(studentsQuery.error as Error).message}</p>}

      {/* Empty state */}
      {!studentsQuery.isLoading && students.length === 0 && (
        <p className="sk-state">No students found. Add one above.</p>
      )}

      {/* Students table */}
      {students.length > 0 && (
        <div className="sk-card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Roll no.</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Admission no.</th>
                  <th style={thStyle}>Class</th>
                  <th style={thStyle}>Guardian</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Portal login</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td style={{ ...tdStyle, color: 'var(--sk-ink-3)' }}>{student.rollNo ?? '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 650 }}>
                      {student.firstName} {student.lastName}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--sk-ink-3)' }}>{student.admissionNo}</td>
                    <td style={tdStyle}>
                      {classBadgeLabel(student) ? (
                        <span className="sk-pill" data-tone="info">
                          {classBadgeLabel(student)}
                        </span>
                      ) : (
                        <span className="sk-muted">—</span>
                      )}
                    </td>
                    <td style={tdStyle}>{student.guardianName ?? <span className="sk-muted">—</span>}</td>
                    <td style={tdStyle}>{student.guardianPhone ?? <span className="sk-muted">—</span>}</td>
                    <td style={tdStyle}>
                      {student.userId ? (
                        <span className="sk-pill" data-tone="good" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 className="h-3 w-3" />
                          Has login
                        </span>
                      ) : (
                        <button
                          className="sk-btn"
                          disabled={createLoginMutation.isPending}
                          onClick={() => createLoginMutation.mutate(student.id)}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Create login
                        </button>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          className="sk-btn"
                          onClick={() => {
                            setShowAdd(false);
                            setEditId(student.id);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          className="sk-btn"
                          disabled={deleteMutation.isPending}
                          onClick={() => confirmDeleteStudent(student)}
                          style={{ color: 'var(--sk-bad)' }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
