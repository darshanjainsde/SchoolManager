'use client';
import { useEffect, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, X, KeyRound, CheckCircle2, Send } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ────────────────────────────────────────────────────────────────────

const STAFF_ROLES = ['OFFICE', 'SUPPORT', 'DRIVER', 'HELPER', 'SECURITY', 'OTHER'] as const;
type StaffRoleValue = (typeof STAFF_ROLES)[number];

const ROLE_LABELS: Record<StaffRoleValue, string> = {
  OFFICE: 'Office',
  SUPPORT: 'Support',
  DRIVER: 'Driver',
  HELPER: 'Helper',
  SECURITY: 'Security',
  OTHER: 'Other',
};

interface Staff {
  id: string;
  firstName: string;
  lastName: string;
  role: StaffRoleValue;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
  isActive: boolean;
}

/** Shape returned by both `.../login` and `.../invite/resend`. */
interface LoginInviteResult {
  email: string;
  username: string | null;
  loginName: string;
  invited: true;
  emailSent: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

function initials(s: Staff) {
  return `${s.firstName.charAt(0)}${s.lastName.charAt(0)}`.toUpperCase();
}

function fullName(s: Staff) {
  return `${s.firstName} ${s.lastName}`;
}

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

// Themed inputs: no dedicated CSS class, styled inline, with a brand-colored
// focus ring applied directly to the DOM node on focus/blur.
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

// ── Add / Edit form ──────────────────────────────────────────────────────────

interface StaffFormProps {
  title: string;
  initial?: Partial<Staff>;
  onSave: (data: {
    firstName: string;
    lastName: string;
    role: StaffRoleValue;
    email: string;
    phone: string;
  }) => void;
  isSaving: boolean;
  onCancel: () => void;
}

/**
 * Confirms an invite was sent. Never shows a password — the staff member sets
 * their own via the emailed link.
 */
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
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
        className="sk-card"
        style={{ width: '100%', maxWidth: 420 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="s-invite-h"
      >
        <div
          className="sk-card-h"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <h3 id="s-invite-h">Invite sent</h3>
          <button onClick={onClose} className="sk-btn sk-press" aria-label="Close" style={{ padding: 7 }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sk-card-b">
          {result.emailSent ? (
            <p style={{ margin: 0, fontSize: 13.5 }}>
              An email was sent to <strong>{result.email}</strong>. They sign in as{' '}
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
                The account was created, but the invite email to {result.email} could not be sent right now.
              </p>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                They sign in as <strong>{result.loginName}</strong> once the email arrives — try resending it.
              </p>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
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
      </div>
    </div>
  );
}

function StaffForm({ title, initial = {}, onSave, isSaving, onCancel }: StaffFormProps) {
  const [firstName, setFirstName] = useState(initial.firstName ?? '');
  const [lastName, setLastName] = useState(initial.lastName ?? '');
  const [role, setRole] = useState<StaffRoleValue>(initial.role ?? 'OTHER');
  const [email, setEmail] = useState(initial.email ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');

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
              placeholder="Ravi"
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
              placeholder="Kumar"
            />
          </Field>
        </div>
        <Field label="Role" htmlFor="sf-role">
          <select
            id="sf-role"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRoleValue)}
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Email (optional)" htmlFor="sf-email">
            <input
              id="sf-email"
              type="email"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ravi.kumar@school.com"
            />
          </Field>
          <Field label="Phone (optional)" htmlFor="sf-phone">
            <input
              id="sf-phone"
              type="tel"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            className="sk-btn sk-press"
            data-variant="primary"
            onClick={() =>
              onSave({
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                role,
                email: email.trim(),
                phone: phone.trim(),
              })
            }
            disabled={isSaving || !firstName.trim() || !lastName.trim()}
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StaffPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  // Id of the staff member added in this session — see `sk-pinin` below.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<(LoginInviteResult & { staffId: string }) | null>(
    null,
  );

  // ── Queries ──────────────────────────────────────────────────────────────
  const staffQuery = useQuery({
    queryKey: ['mng-staff'],
    queryFn: () => api.get<Staff[]>('/manage/staff'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (body: {
      firstName: string;
      lastName: string;
      role: StaffRoleValue;
      email?: string;
      phone?: string;
    }) => api.post<Staff>('/manage/staff', body),
    onSuccess: (created) => {
      // Which card is the new one — see `sk-pinin` on the grid below.
      setJustAddedId(created?.id ?? null);
      void queryClient.invalidateQueries({ queryKey: ['mng-staff'] });
      setShowAdd(false);
      toast.success('Staff member added');
    },
    onError: (err: Error) => toast.error(`Failed to add staff member: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      firstName: string;
      lastName: string;
      role: StaffRoleValue;
      email?: string;
      phone?: string;
    }) => api.put<Staff>(`/manage/staff/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-staff'] });
      setEditId(null);
      toast.success('Staff member updated');
    },
    onError: (err: Error) => toast.error(`Failed to update staff member: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/staff/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-staff'] });
      toast.success('Staff member removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete staff member: ${err.message}`),
  });

  // The API falls back to the staff member's stored email when none is
  // passed, so a staff member with an address on file needs no extra input.
  const createLoginMutation = useMutation({
    mutationFn: (staffId: string) =>
      api.post<LoginInviteResult>(`/manage/staff/${staffId}/login`, {}),
    onSuccess: (result, staffId) => {
      void queryClient.invalidateQueries({ queryKey: ['mng-staff'] });
      setInviteResult({ ...result, staffId });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resendInviteMutation = useMutation({
    mutationFn: (staffId: string) =>
      api.post<LoginInviteResult>(`/manage/staff/${staffId}/invite/resend`, {}),
    onSuccess: (result, staffId) => {
      setInviteResult((prev) => (prev && prev.staffId === staffId ? { ...result, staffId } : prev));
      if (result.emailSent) toast.success(`Invite resent to ${result.email}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeleteStaff(member: Staff) {
    const ok = window.confirm(`Remove ${fullName(member)}? This can’t be undone.`);
    if (ok) deleteMutation.mutate(member.id);
  }

  const staff = staffQuery.data ?? [];
  const activeCount = staff.filter((s) => s.isActive).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {inviteResult && (
        <InviteSentModal
          result={inviteResult}
          onClose={() => setInviteResult(null)}
          onResend={() => resendInviteMutation.mutate(inviteResult.staffId)}
          resending={resendInviteMutation.isPending}
        />
      )}
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Staff</h1>
          <p>Manage your school&apos;s non-teaching staff — office, support, drivers, and more.</p>
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
              <Plus className="h-4 w-4" /> Add staff
            </>
          )}
        </button>
      </header>

      {staff.length > 0 && (
        <div className="sk-kpis" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          {/* Head-counts compared against each other — monospace + tabular
              so the digits sit on one grid instead of shifting as they load. */}
          <div className="sk-kpi">
            <span className="lab">Total staff</span>
            <span className="n sk-num">{staff.length}</span>
          </div>
          <div className="sk-kpi" data-tone="good">
            <span className="lab">Active</span>
            <span className="n sk-num">{activeCount}</span>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div style={{ marginBottom: 18 }}>
          <StaffForm
            title="Add staff"
            onSave={({ firstName, lastName, role, email, phone }) =>
              addMutation.mutate({
                firstName,
                lastName,
                role,
                email: email || undefined,
                phone: phone || undefined,
              })
            }
            isSaving={addMutation.isPending}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {/* Loading / error states */}
      {staffQuery.isLoading && <p className="sk-state">Loading…</p>}
      {staffQuery.error && <p className="sk-state err">{(staffQuery.error as Error).message}</p>}

      {/* Empty state */}
      {!staffQuery.isLoading && staff.length === 0 && (
        <p className="sk-state">No staff yet. Add one above.</p>
      )}

      {/* Staff grid */}
      {staff.length > 0 && (
        <div className="sk-cardgrid">
          {staff.map((member, i) =>
            editId === member.id ? (
              <StaffForm
                key={member.id}
                title="Edit staff"
                initial={member}
                onSave={({ firstName, lastName, role, email, phone }) =>
                  updateMutation.mutate({
                    id: member.id,
                    firstName,
                    lastName,
                    role,
                    email: email || undefined,
                    phone: phone || undefined,
                  })
                }
                isSaving={updateMutation.isPending}
                onCancel={() => setEditId(null)}
              />
            ) : (
              // `sk-pinin` on the one card just created: it drops in slightly
              // rotated and settles square, like a slip pinned to a board.
              // The grid is server-sorted, so a new entry can appear anywhere
              // in it — the gesture says WHERE, which the toast cannot.
              // Reduced motion collapses it to the settled card.
              <div
                key={member.id}
                className={member.id === justAddedId ? 'sk-entity sk-pinin sk-in' : 'sk-entity'}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="av" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                    {initials(member)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{fullName(member)}</div>
                    {member.email && <div className="meta">{member.email}</div>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      <span className="sk-pill" data-tone="info">
                        {ROLE_LABELS[member.role]}
                      </span>
                      {!member.isActive && (
                        <span className="sk-pill" data-tone="warn">
                          Inactive
                        </span>
                      )}
                      {member.userId ? (
                        <span className="sk-pill" data-tone="good">
                          <CheckCircle2 className="h-3 w-3" style={{ display: 'inline', verticalAlign: '-2px' }} />{' '}
                          Has login
                        </span>
                      ) : (
                        <span className="sk-pill" data-tone="info">
                          No login yet
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {member.userId ? (
                    <button
                      className="sk-btn sk-press"
                      disabled={resendInviteMutation.isPending}
                      onClick={() => resendInviteMutation.mutate(member.id)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Resend invite
                    </button>
                  ) : (
                    <button
                      className="sk-btn sk-press"
                      data-variant="primary"
                      disabled={createLoginMutation.isPending}
                      onClick={() => createLoginMutation.mutate(member.id)}
                      title={member.email ? undefined : 'Add an email to this staff member first'}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Create login
                    </button>
                  )}
                  <button
                    className="sk-btn sk-press"
                    onClick={() => {
                      setShowAdd(false);
                      setEditId(member.id);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    className="sk-btn sk-press"
                    disabled={deleteMutation.isPending}
                    onClick={() => confirmDeleteStaff(member)}
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
