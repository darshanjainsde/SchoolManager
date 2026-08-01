'use client';
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X, KeyRound, CheckCircle2, Send } from 'lucide-react';
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
  email: string | null;
  classSectionId: string | null;
  rollNo: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  photoAssetId: string | null;
  classSection: { name: string; grade: { name: string } } | null;
  userId: string | null;
}

interface MediaAsset {
  id: string;
  url: string;
}

/** Shape returned by both `.../login` and `.../invite/resend`. */
interface LoginInviteResult {
  email: string;
  username: string | null;
  loginName: string;
  invited: true;
  emailSent: boolean;
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

// ── Dialog shell (Escape-to-close + basic focus trap) ────────────────────────

function DialogShell({
  onClose,
  labelledBy,
  maxWidth = 420,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  maxWidth?: number;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    const focusable = el?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && el) {
        const items = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

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
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className="sk-card"
        style={{ width: '100%', maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

// ── Invite-sent confirmation modal ───────────────────────────────────────────
// Never shows a password — the recipient sets their own via the emailed link.

function InviteSentModal({
  result,
  onClose,
  onResend,
  resending,
}: {
  result: LoginInviteResult;
  onClose: () => void;
  onResend: () => void;
  resending: boolean;
}) {
  return (
    <DialogShell onClose={onClose} labelledBy="invite-sent-h">
      <div className="sk-card-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 id="invite-sent-h">Invite sent</h3>
        <button onClick={onClose} className="sk-btn" aria-label="Close" style={{ padding: 7 }}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="sk-card-b">
        {result.emailSent ? (
          <p style={{ margin: 0, fontSize: 13.5 }}>
            An email was sent to <strong>{result.email}</strong>. They can sign in as{' '}
            <strong>{result.loginName}</strong> — the link lets them set their own password.
          </p>
        ) : (
          <>
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
              The account was created, but the invite email to {result.email} could not be sent right
              now.
            </p>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              They can sign in as <strong>{result.loginName}</strong> and set their own password once the
              email arrives — try resending it below.
            </p>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {!result.emailSent && (
            <button className="sk-btn" data-variant="primary" disabled={resending} onClick={onResend}>
              <Send className="h-3.5 w-3.5" />
              {resending ? 'Resending…' : 'Resend invite'}
            </button>
          )}
          <button className="sk-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ── Email-prompt modal (used when the student has no email on record) ───────

function EmailPromptModal({
  studentName,
  onSubmit,
  onClose,
  isSaving,
}: {
  studentName: string;
  onSubmit: (email: string) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [email, setEmail] = useState('');
  return (
    <DialogShell onClose={onClose} labelledBy="email-prompt-h">
      <div className="sk-card-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 id="email-prompt-h">Send login invite</h3>
        <button onClick={onClose} className="sk-btn" aria-label="Close" style={{ padding: 7 }}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="sk-card-b">
        <p className="sk-muted" style={{ margin: 0 }}>
          No email on file for {studentName}. Enter one to send the portal login invite.
        </p>
        <Field label="Email" htmlFor="ep-email">
          <input
            id="ep-email"
            type="email"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane.doe@example.com"
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            className="sk-btn"
            data-variant="primary"
            disabled={isSaving || !email.trim()}
            onClick={() => onSubmit(email.trim())}
          >
            {isSaving ? 'Sending…' : 'Send invite'}
          </button>
          <button className="sk-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </DialogShell>
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
  email: string;
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
  const [email, setEmail] = useState(initial.email ?? '');

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

        <Field label="Email (for portal login, optional)" htmlFor="sf-email">
          <input
            id="sf-email"
            type="email"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane.doe@example.com"
          />
        </Field>

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
                email: email.trim(),
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

function studentInitials(student: Student): string {
  return `${student.firstName.charAt(0)}${student.lastName.charAt(0)}`.toUpperCase();
}

/** Small photo-or-initials avatar for the roster rows — mirrors the Teachers
 *  tab's photoUrlMap rendering (photoAssetId resolved via /site/media). */
function StudentAvatar({ student, photoUrl }: { student: Student; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={`${student.firstName} ${student.lastName}`}
        style={{
          height: 28,
          width: 28,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1px solid var(--sk-line)',
          flex: 'none',
        }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        height: 28,
        width: 28,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10.5,
        fontWeight: 700,
        background: 'var(--sk-brand-tint)',
        color: 'var(--sk-brand-2)',
        flex: 'none',
      }}
    >
      {studentInitials(student)}
    </span>
  );
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
  const [inviteResult, setInviteResult] = useState<(LoginInviteResult & { studentId: string }) | null>(
    null,
  );
  const [promptStudent, setPromptStudent] = useState<Student | null>(null);

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

  // Self-uploaded avatars (POST /me/photo) land as kind=AVATAR MediaAssets —
  // resolve photoAssetId → url exactly like the Teachers tab's photoUrlMap.
  const avatarMediaQuery = useQuery({
    queryKey: ['site-media-avatar'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=AVATAR'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const photoUrlMap: Record<string, string> = {};
  for (const asset of avatarMediaQuery.data ?? []) {
    photoUrlMap[asset.id] = asset.url;
  }

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
        email: data.email || undefined,
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
        email: data.email || undefined,
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
    mutationFn: ({ studentId, email }: { studentId: string; email: string }) =>
      api.post<LoginInviteResult>(`/manage/students/${studentId}/login`, { email }),
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      setInviteResult({ ...result, studentId: variables.studentId });
      setPromptStudent(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resendInviteMutation = useMutation({
    mutationFn: (studentId: string) =>
      api.post<LoginInviteResult>(`/manage/students/${studentId}/invite/resend`),
    onSuccess: (result, studentId) => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      toast.success(`Invite resent to ${result.email}`);
      setInviteResult((prev) => (prev && prev.studentId === studentId ? { ...result, studentId } : prev));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Derive the initial values for the edit form from current student data
  const editingStudent = editId ? (studentsQuery.data ?? []).find((s) => s.id === editId) : null;

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeleteStudent(student: Student) {
    const ok = window.confirm(`Remove ${student.firstName} ${student.lastName}? This can’t be undone.`);
    if (ok) deleteMutation.mutate(student.id);
  }

  // "Create login": use the email on record if there is one, otherwise prompt
  // for one — the invite endpoint always requires a real address.
  function handleCreateLogin(student: Student) {
    if (student.email) {
      createLoginMutation.mutate({ studentId: student.id, email: student.email });
    } else {
      setPromptStudent(student);
    }
  }

  const students = studentsQuery.data ?? [];
  const unassignedCount = students.filter((s) => !s.classSectionId).length;
  const loginCount = students.filter((s) => s.userId).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Invite-sent confirmation modal */}
      {inviteResult && (
        <InviteSentModal
          result={inviteResult}
          onClose={() => setInviteResult(null)}
          onResend={() => resendInviteMutation.mutate(inviteResult.studentId)}
          resending={resendInviteMutation.isPending}
        />
      )}

      {/* Email-prompt modal (student has no email on record yet) */}
      {promptStudent && (
        <EmailPromptModal
          studentName={`${promptStudent.firstName} ${promptStudent.lastName}`}
          onSubmit={(email) => createLoginMutation.mutate({ studentId: promptStudent.id, email })}
          onClose={() => setPromptStudent(null)}
          isSaving={createLoginMutation.isPending}
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
              email: editingStudent.email ?? '',
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <StudentAvatar
                          student={student}
                          photoUrl={
                            student.photoAssetId ? (photoUrlMap[student.photoAssetId] ?? null) : null
                          }
                        />
                        <span>
                          {student.firstName} {student.lastName}
                        </span>
                      </div>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span className="sk-pill" data-tone="good" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle2 className="h-3 w-3" />
                            Has login
                          </span>
                          <button
                            className="sk-btn"
                            disabled={resendInviteMutation.isPending}
                            onClick={() => resendInviteMutation.mutate(student.id)}
                          >
                            <Send className="h-3.5 w-3.5" />
                            Resend invite
                          </button>
                        </div>
                      ) : (
                        <button
                          className="sk-btn"
                          disabled={createLoginMutation.isPending}
                          onClick={() => handleCreateLogin(student)}
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
