'use client';
import Link from 'next/link';
import { useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X, KeyRound, CheckCircle2, Send, UserMinus, Undo2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { ApiError } from '@/lib/api';
import { useHost } from '@/components/use-host';
import DialogShell from '@/components/ui/dialog-shell';
import LeaveDialog from './leave-dialog';

/** The three slices of the roll the page can show (Active Roster). */
type StatusTab = 'active' | 'left' | 'all';
const STATUS_TABS: { id: StatusTab; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'left', label: 'Alumni & left' },
  { id: 'all', label: 'All' },
];

type StudentStatus = 'ACTIVE' | 'ALUMNI' | 'TRANSFERRED' | 'LEFT';

/** "Alumni · 2025-26", "Transferred · 31 Mar 2026", "Left · 31 Mar 2026". */
function statusLabel(s: { status: StudentStatus; leftOn: string | null; alumniBatch: string | null }): string {
  const when = s.leftOn
    ? new Date(s.leftOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  if (s.status === 'ALUMNI') return `Alumni${s.alumniBatch ? ` · ${s.alumniBatch}` : when ? ` · ${when}` : ''}`;
  if (s.status === 'TRANSFERRED') return `Transferred${when ? ` · ${when}` : ''}`;
  return `Left${when ? ` · ${when}` : ''}`;
}

/** The API answers a designed refusal with a `code` in the body; clients branch on it, never on the message. */
function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    return (err.body as { code?: string }).code;
  }
  return undefined;
}

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
  status: StudentStatus;
  leftOn: string | null;
  alumniBatch: string | null;
  dob: string | null;
  showOnWebsite: boolean;
  photoConsent: boolean;
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
      <div className="sk-card-h sk-wrap-sm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 id="invite-sent-h">Invite sent</h3>
        <button onClick={onClose} className="sk-btn sk-press" aria-label="Close" style={{ padding: 7 }}>
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
        <div className="sk-wrap-sm" style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {!result.emailSent && (
            <button className="sk-btn sk-press" data-variant="primary" disabled={resending} onClick={onResend}>
              <Send className="h-3.5 w-3.5" />
              {resending ? 'Resending…' : 'Resend invite'}
            </button>
          )}
          <button className="sk-btn sk-press" onClick={onClose}>
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
        <button onClick={onClose} className="sk-btn sk-press" aria-label="Close" style={{ padding: 7 }}>
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
        <div className="sk-wrap-sm" style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            className="sk-btn sk-press"
            data-variant="primary"
            disabled={isSaving || !email.trim()}
            onClick={() => onSubmit(email.trim())}
          >
            {isSaving ? 'Sending…' : 'Send invite'}
          </button>
          <button className="sk-btn sk-press" onClick={onClose}>
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
  /** YYYY-MM-DD, or '' for none. Birthdays on the website need it. */
  dob: string;
  showOnWebsite: boolean;
  photoConsent: boolean;
}

interface StudentFormProps {
  title: string;
  initial?: Partial<StudentFormData>;
  classes: SchoolClass[];
  onSave: (data: StudentFormData) => void;
  isSaving: boolean;
  onCancel: () => void;
  /** The website-birthday switches: only once a student exists (create has no such fields). */
  websiteOptions?: boolean;
}

function StudentForm({ title, initial = {}, classes, onSave, isSaving, onCancel, websiteOptions = false }: StudentFormProps) {
  const [firstName, setFirstName] = useState(initial.firstName ?? '');
  const [lastName, setLastName] = useState(initial.lastName ?? '');
  const [admissionNo, setAdmissionNo] = useState(initial.admissionNo ?? '');
  const [rollNo, setRollNo] = useState(initial.rollNo ?? '');
  const [classSectionId, setClassSectionId] = useState(initial.classSectionId ?? '');
  const [guardianName, setGuardianName] = useState(initial.guardianName ?? '');
  const [guardianPhone, setGuardianPhone] = useState(initial.guardianPhone ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [dob, setDob] = useState(initial.dob ?? '');
  const [showOnWebsite, setShowOnWebsite] = useState(initial.showOnWebsite ?? true);
  const [photoConsent, setPhotoConsent] = useState(initial.photoConsent ?? false);

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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
        <Field label="Date of birth (optional)" htmlFor="sf-dob">
          <input
            id="sf-dob"
            type="date"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
        </Field>
        </div>

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

        {websiteOptions && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="sk-lab">Website birthdays</span>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={showOnWebsite} onChange={(e) => setShowOnWebsite(e.target.checked)} />
              Show on the birthday wall
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={photoConsent} onChange={(e) => setPhotoConsent(e.target.checked)} />
              Parents have given photo consent
            </label>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            className="sk-btn sk-press"
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
                dob,
                showOnWebsite,
                photoConsent,
              })
            }
            disabled={isSaving || !canSave}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button className="sk-btn sk-press" onClick={onCancel}>
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StudentsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch] = useState('');
  // Id of the student added in this session, so their row can be seen landing
  // in the register rather than just being there on the next render.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<(LoginInviteResult & { studentId: string }) | null>(
    null,
  );
  const [promptStudent, setPromptStudent] = useState<Student | null>(null);
  // Active Roster: which slice of the roll, the multi-select on it, and the
  // children a "Mark as left" dialog is open for.
  const [statusTab, setStatusTab] = useState<StatusTab>('active');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [leaveTargets, setLeaveTargets] = useState<Student[] | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  // The school's feature set (shared with the sidebar's query): PRESS means a
  // Transfer Certificate is one click away after marking a child as left.
  const meQuery = useQuery({
    queryKey: ['me', host],
    queryFn: () => api.get<{ features?: string[] }>('/auth/me'),
    enabled: !!host,
    staleTime: 5 * 60_000,
  });
  const hasPress = (meQuery.data?.features ?? []).includes('PRESS');

  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const studentsQuery = useQuery({
    queryKey: ['mng-students', classFilter, statusTab],
    queryFn: () => {
      const params = new URLSearchParams({ status: statusTab });
      if (classFilter) params.set('classSectionId', classFilter);
      return api.get<Student[]>(`/manage/students?${params.toString()}`);
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
        dob: data.dob || undefined,
      };
      return api.post<Student>('/manage/students', body);
    },
    onSuccess: (created) => {
      // Remember which row is the new one so it can drop into the register
      // (see `sk-pinin` on the <tr> below). Presentational only — the roll is
      // sorted by the server, so a student added mid-list would otherwise
      // appear silently somewhere the admin is not looking.
      setJustAddedId(created?.id ?? null);
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
      const body: Record<string, string | boolean | undefined> = {
        firstName: data.firstName,
        lastName: data.lastName,
        admissionNo: data.admissionNo,
        rollNo: data.rollNo || undefined,
        classSectionId: data.classSectionId || undefined,
        guardianName: data.guardianName || undefined,
        guardianPhone: data.guardianPhone || undefined,
        email: data.email || undefined,
        dob: data.dob || undefined,
        showOnWebsite: data.showOnWebsite,
        photoConsent: data.photoConsent,
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
    onError: (err: Error, id) => {
      // Delete is for a wrong entry only. A child with attendance, results,
      // diary, library or messages is marked as left instead — the API
      // refuses (HAS_HISTORY) and the dialog opens in Delete's place.
      if (errorCode(err) === 'HAS_HISTORY') {
        toast.error('This student has history. Mark them as left instead.');
        const target = (studentsQuery.data ?? []).find((s) => s.id === id);
        if (target) setLeaveTargets([target]);
        return;
      }
      toast.error(`Failed to delete student: ${err.message}`);
    },
  });

  const readmitMutation = useMutation({
    mutationFn: (id: string) => api.post<{ id: string; status: 'ACTIVE' }>(`/manage/students/${id}/readmit`, {}),
    onSuccess: (_r, id) => {
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      // Back on the roll with no class yet: land the office on the edit form
      // so the seat is the next thing they set, on the Active tab.
      setStatusTab('active');
      setShowAdd(false);
      setEditId(id);
      toast.success('Re-admitted — set their class');
    },
    onError: (err: Error) => toast.error(`Could not re-admit: ${err.message}`),
  });

  function toggleSelected(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

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

  // Safe-delete: confirm before firing the destructive mutation. The API
  // refuses once the child has history, and the leave dialog takes over.
  function confirmDeleteStudent(student: Student) {
    const ok = window.confirm(
      `Delete ${student.firstName} ${student.lastName}? This is for a wrong entry only and can’t be undone. A child who has left the school should be marked as left instead.`,
    );
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

  const allStudents = studentsQuery.data ?? [];
  /**
   * Search is over what is already loaded, not a second request.
   *
   * The list arrives whole under a ceiling, so filtering it here is instant
   * and cannot disagree with the counts above it. Name, admission number and
   * guardian, because those are the three things somebody at the office
   * counter is holding when they need to find a child — an admission slip, a
   * parent on the phone, or a name.
   */
  const students = allStudents.filter((st) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      `${st.firstName} ${st.lastName}`.toLowerCase().includes(q) ||
      st.admissionNo.toLowerCase().includes(q) ||
      (st.guardianName ?? '').toLowerCase().includes(q)
    );
  });
  const unassignedCount = students.filter((s) => !s.classSectionId).length;
  const loginCount = students.filter((s) => s.userId).length;
  // Only active children can be marked as left, and only the ones on screen.
  const selectable = statusTab === 'active';
  const selectedShown = selectable ? students.filter((s) => selected.has(s.id)) : [];
  const allShownSelected = selectable && students.length > 0 && students.every((s) => selected.has(s.id));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Mark as left — one child from a row, or the whole selection */}
      {leaveTargets && leaveTargets.length > 0 && (
        <LeaveDialog
          students={leaveTargets}
          hasPress={hasPress}
          onDone={() => {
            setLeaveTargets(null);
            setSelected(new Set());
            void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
          }}
          onCancel={() => setLeaveTargets(null)}
        />
      )}

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
      <header className="sk-pagehead sk-wrap-sm" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Students</h1>
          <p>Manage enrolled students.</p>
        </div>
        <button
          className="sk-btn sk-press"
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

      {/* Which slice of the roll: the school as it is today, everyone who has
          left, or the whole register. The same recipe as the Alumni Office tabs. */}
      <nav className="sk-tabs" style={{ marginBottom: 18, padding: 0 }} aria-label="Roll">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="sk-tab"
            aria-current={statusTab === t.id ? 'page' : undefined}
            data-active={statusTab === t.id ? 'true' : undefined}
            onClick={() => {
              setStatusTab(t.id);
              setSelected(new Set());
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {students.length > 0 && (
        <div className="sk-kpis" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          {/* Counts read against each other — monospace, tabular, so the
              digits share a grid and stop shifting as the query settles. */}
          <div className="sk-kpi">
            <span className="lab">Students shown</span>
            <span className="n sk-num">{students.length}</span>
            <span className="hint">
              {search.trim() ? 'filtered by search' : classFilter ? 'filtered by class' : 'on the roll'}
            </span>
          </div>
          <div className="sk-kpi" data-tone={unassignedCount > 0 ? 'warn' : undefined}>
            <span className="lab">Without a class</span>
            <span className="n sk-num">{unassignedCount}</span>
            <span className="hint">
              {unassignedCount > 0 ? 'need placing in a section' : 'everybody is placed'}
            </span>
          </div>
          <div className="sk-kpi" data-tone="good">
            <span className="lab">Portal logins</span>
            <span className="n sk-num">{loginCount}</span>
            <span className="hint">
              {students.length ? `of ${students.length} shown` : 'families who can sign in'}
            </span>
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
              dob: editingStudent.dob ? editingStudent.dob.slice(0, 10) : '',
              showOnWebsite: editingStudent.showOnWebsite ?? true,
              photoConsent: editingStudent.photoConsent ?? false,
            }}
            websiteOptions
            classes={classesQuery.data ?? []}
            onSave={(data) => updateMutation.mutate({ id: editId, data })}
            isSaving={updateMutation.isPending}
            onCancel={() => setEditId(null)}
          />
        </div>
      )}

      {/* The controls that act on the table below, as a strip rather than a
          card: a whole panel holding one select read as a section of the page
          instead of as a filter on the list. */}
      <div className="sk-toolbar">
        <input
          className="sk-input grow"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a name, an admission number or a guardian…"
          aria-label="Search students"
        />
        <select
          id="class-filter"
          className="sk-input"
          style={{ maxWidth: 240, width: 'auto' }}
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          aria-label="Filter by class"
        >
          <option value="">All classes</option>
          {(classesQuery.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.grade.name} — {c.name}
            </option>
          ))}
        </select>
        {search.trim() ? (
          <span className="count">
            {students.length} of {allStudents.length}
          </span>
        ) : null}
      </div>

      {/* Loading / error */}
      {studentsQuery.isLoading && <p className="sk-state">Loading…</p>}
      {studentsQuery.error && <p className="sk-state err">{(studentsQuery.error as Error).message}</p>}

      {/* Empty state */}
      {!studentsQuery.isLoading && students.length === 0 && (
        <p className="sk-state">
          {allStudents.length === 0
            ? statusTab === 'left'
              ? 'Nobody has left yet. When a child passes out or moves school, mark them as left and they will be kept here.'
              : 'No students yet. Add the first one above.'
            : search.trim()
              ? `Nobody matches “${search.trim()}”.`
              : 'No students in that class.'}
        </p>
      )}

      {/* The selection bar: how many, and the one thing you do with them. */}
      {selectedShown.length > 0 && (
        <div className="sk-toolbar" role="region" aria-label="Selected students" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 650 }}>
            {selectedShown.length} selected
          </span>
          <button
            type="button"
            className="sk-btn sk-press"
            data-variant="primary"
            onClick={() => setLeaveTargets(selectedShown)}
          >
            <UserMinus className="h-4 w-4" /> Mark as left
          </button>
          <button type="button" className="sk-btn sk-press" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Students table */}
      {students.length > 0 && (
        <div className="sk-card" style={{ overflow: 'hidden' }}>
          <div className="sk-tblwrap">
            <table className="sk-tbl">
              <thead>
                <tr>
                  {selectable && (
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label="Select every student shown"
                        checked={allShownSelected}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(students.map((s) => s.id)) : new Set())
                        }
                      />
                    </th>
                  )}
                  <th>Roll</th>
                  <th>Name</th>
                  <th>Admission no.</th>
                  <th>Class</th>
                  {/* Guardian and contact fold away on a phone: neither is the
                      only place it appears — the child's own page has both. */}
                  <th data-priority="2">Guardian</th>
                  <th data-priority="2">Contact</th>
                  <th>Portal login</th>
                  <th className="acts"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  // `sk-pinin` on the one row just created: it drops in
                  // slightly rotated and settles square, the way a new slip is
                  // pinned to a register. The point is locating it — the list
                  // is server-sorted, so a new student can land anywhere in a
                  // long table, and the toast alone does not say WHERE.
                  // Reduced motion collapses this to the settled row, which is
                  // the same information minus the pointer.
                  <tr key={student.id} className={student.id === justAddedId ? 'sk-pinin sk-in' : undefined}>
                    {selectable && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${student.firstName} ${student.lastName}`}
                          checked={selected.has(student.id)}
                          onChange={(e) => toggleSelected(student.id, e.target.checked)}
                        />
                      </td>
                    )}
                    {/* Roll and admission numbers are read down the column, so
                        they take the register's monospace face. */}
                    <td className="num">{student.rollNo ?? '—'}</td>
                    <td style={{ fontWeight: 650 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <StudentAvatar
                          student={student}
                          photoUrl={
                            student.photoAssetId ? (photoUrlMap[student.photoAssetId] ?? null) : null
                          }
                        />
                        {/* The name is the door to the child's whole file. */}
                        <Link href={`/app/students/${student.id}`} className="sk-seelink" style={{ color: 'var(--sk-ink)', fontWeight: 650 }}>
                          {student.firstName} {student.lastName}
                        </Link>
                        {/* Where they stand, when it is not "here". */}
                        {student.status !== 'ACTIVE' && (
                          <span className="sk-pill" data-tone={student.status === 'ALUMNI' ? 'info' : 'neutral'}>
                            {statusLabel(student)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num">{student.admissionNo}</td>
                    <td>
                      {classBadgeLabel(student) ? (
                        <span className="sk-pill" data-tone="info">
                          {classBadgeLabel(student)}
                        </span>
                      ) : (
                        <span className="sk-muted">—</span>
                      )}
                    </td>
                    <td data-priority="2">{student.guardianName ?? <span className="sk-muted">—</span>}</td>
                    <td data-priority="2" className="num">{student.guardianPhone ?? '—'}</td>
                    <td>
                      {/* The state, and the one thing you do about it, on ONE
                          line. A full-width button under a pill is what made
                          every row two lines tall. */}
                      <span className="pairs">
                        {student.userId ? (
                          <>
                            <span className="sk-pill" data-tone="good" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <CheckCircle2 className="h-3 w-3" />
                              Has login
                            </span>
                            <button
                              className="sk-btn sk-press"
                              data-icon
                              aria-label={`Resend the portal invite to ${student.firstName} ${student.lastName}`}
                              title="Resend invite"
                              disabled={resendInviteMutation.isPending}
                              onClick={() => resendInviteMutation.mutate(student.id)}
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="sk-pill" data-tone="neutral">No login</span>
                            <button
                              className="sk-btn sk-press"
                              data-icon
                              aria-label={`Create a portal login for ${student.firstName} ${student.lastName}`}
                              title="Create login"
                              disabled={createLoginMutation.isPending}
                              onClick={() => handleCreateLogin(student)}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="acts">
                      <span>
                        <button
                          className="sk-btn sk-press"
                          data-icon
                          aria-label={`Edit ${student.firstName} ${student.lastName}`}
                          title="Edit"
                          onClick={() => {
                            setShowAdd(false);
                            setEditId(student.id);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {student.status === 'ACTIVE' ? (
                          <>
                            {/* The ordinary way a child leaves the roll. */}
                            <button
                              className="sk-btn sk-press"
                              data-icon
                              aria-label={`Mark ${student.firstName} ${student.lastName} as left`}
                              title="Mark as left"
                              onClick={() => setLeaveTargets([student])}
                            >
                              <UserMinus className="h-4 w-4" />
                            </button>
                            {/* For a wrong entry only — the API refuses once there is history. */}
                            <button
                              className="sk-btn sk-press"
                              data-icon
                              data-tone="bad"
                              aria-label={`Delete ${student.firstName} ${student.lastName}`}
                              title="Delete (wrong entry only)"
                              disabled={deleteMutation.isPending}
                              onClick={() => confirmDeleteStudent(student)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            className="sk-btn sk-press"
                            data-icon
                            aria-label={`Re-admit ${student.firstName} ${student.lastName}`}
                            title="Re-admit"
                            disabled={readmitMutation.isPending}
                            onClick={() => readmitMutation.mutate(student.id)}
                          >
                            <Undo2 className="h-4 w-4" />
                          </button>
                        )}
                      </span>
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
