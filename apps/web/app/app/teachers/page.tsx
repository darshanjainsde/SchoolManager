'use client';
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, Pencil, X, KeyRound, CheckCircle2, Send } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ────────────────────────────────────────────────────────────────────

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  username?: string | null;
  phone?: string | null;
  photoAssetId?: string | null;
  primarySubjectId?: string | null;
  bio?: string | null;
  isActive: boolean;
  userId?: string | null;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

function initials(t: Teacher) {
  return `${t.firstName.charAt(0)}${t.lastName.charAt(0)}`.toUpperCase();
}

function fullName(t: Teacher) {
  return `${t.firstName} ${t.lastName}`;
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

interface TeacherFormProps {
  title: string;
  initial?: Partial<Teacher>;
  photoUrl?: string | null;
  onSave: (data: {
    firstName: string;
    lastName: string;
    email: string;
    photoAssetId: string | null;
  }) => void;
  isSaving: boolean;
  onCancel: () => void;
  onPhotoUpload: (file: File) => void;
  isUploadingPhoto: boolean;
  uploadedPhotoUrl: string | null;
}

/**
 * Confirms an invite was sent. Never shows a password — the teacher sets their
 * own via the emailed link.
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
        aria-labelledby="t-invite-h"
      >
        <div
          className="sk-card-h"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <h3 id="t-invite-h">Invite sent</h3>
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

function TeacherForm({
  title,
  initial = {},
  photoUrl,
  onSave,
  isSaving,
  onCancel,
  onPhotoUpload,
  isUploadingPhoto,
  uploadedPhotoUrl,
}: TeacherFormProps) {
  const [firstName, setFirstName] = useState(initial.firstName ?? '');
  const [lastName, setLastName] = useState(initial.lastName ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const photoInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = uploadedPhotoUrl ?? photoUrl;

  return (
    <div className="sk-card" style={{ maxWidth: 560 }}>
      <div className="sk-card-h">
        <h3>{title}</h3>
      </div>
      <div className="sk-card-b">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="First name" htmlFor="tf-first">
            <input
              id="tf-first"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
            />
          </Field>
          <Field label="Last name" htmlFor="tf-last">
            <input
              id="tf-last"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Smith"
            />
          </Field>
        </div>
        <Field label="Email (optional — needed to create their login)" htmlFor="tf-email">
          <input
            id="tf-email"
            type="email"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane.smith@school.com"
          />
        </Field>

        {/* Photo upload */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="sk-lab">Photo (optional)</span>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Teacher photo"
              style={{
                height: 72,
                width: 72,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '1px solid var(--sk-line)',
              }}
            />
          ) : initial.photoAssetId ? (
            <p className="sk-muted" style={{ margin: 0, fontStyle: 'italic' }}>
              Photo set — upload to replace.
            </p>
          ) : (
            <p className="sk-muted" style={{ margin: 0 }}>
              No photo set.
            </p>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPhotoUpload(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="sk-btn sk-press"
            style={{ alignSelf: 'flex-start' }}
            disabled={isUploadingPhoto}
            onClick={() => photoInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {isUploadingPhoto ? 'Uploading…' : previewUrl || initial.photoAssetId ? 'Replace photo' : 'Upload photo'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            className="sk-btn sk-press"
            data-variant="primary"
            onClick={() =>
              onSave({
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                email: email.trim(),
                photoAssetId: initial.photoAssetId ?? null,
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

export default function TeachersPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  // Id of the teacher added in this session, so their card can be seen
  // arriving in the grid rather than simply existing on the next render.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<(LoginInviteResult & { teacherId: string }) | null>(
    null,
  );

  // Photo state for the add form
  const [addPhotoAssetId, setAddPhotoAssetId] = useState<string | null>(null);
  const [addPhotoUrl, setAddPhotoUrl] = useState<string | null>(null);
  const [isUploadingAddPhoto, setIsUploadingAddPhoto] = useState(false);

  // Photo state for the edit form
  const [editPhotoAssetId, setEditPhotoAssetId] = useState<string | null>(null);
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [isUploadingEditPhoto, setIsUploadingEditPhoto] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────
  const teachersQuery = useQuery({
    queryKey: ['mng-teachers'],
    queryFn: () => api.get<Teacher[]>('/manage/teachers'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  // Media for resolving photo URLs
  const staffMediaQuery = useQuery({
    queryKey: ['site-media-staff'],
    queryFn: () => api.get<MediaAsset[]>('/site/media?kind=STAFF'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const photoUrlMap: Record<string, string> = {};
  for (const asset of staffMediaQuery.data ?? []) {
    photoUrlMap[asset.id] = asset.url;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (body: {
      firstName: string;
      lastName: string;
      email?: string;
      photoAssetId?: string | null;
    }) => api.post<Teacher>('/manage/teachers', body),
    onSuccess: (created) => {
      // Which card is the new one — see `sk-pinin` on the grid below.
      setJustAddedId(created?.id ?? null);
      void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
      setShowAdd(false);
      resetAddForm();
      toast.success('Teacher added');
    },
    onError: (err: Error) => toast.error(`Failed to add teacher: ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      firstName: string;
      lastName: string;
      email?: string;
      photoAssetId?: string | null;
    }) => api.put<Teacher>(`/manage/teachers/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
      setEditId(null);
      resetEditForm();
      toast.success('Teacher updated');
    },
    onError: (err: Error) => toast.error(`Failed to update teacher: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/teachers/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
      toast.success('Teacher removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete teacher: ${err.message}`),
  });

  // The API falls back to the teacher's stored email when none is passed, so a
  // teacher with an address on file needs no extra input.
  const createLoginMutation = useMutation({
    mutationFn: (teacherId: string) =>
      api.post<LoginInviteResult>(`/manage/teachers/${teacherId}/login`, {}),
    onSuccess: (result, teacherId) => {
      void queryClient.invalidateQueries({ queryKey: ['mng-teachers'] });
      setInviteResult({ ...result, teacherId });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resendInviteMutation = useMutation({
    mutationFn: (teacherId: string) =>
      api.post<LoginInviteResult>(`/manage/teachers/${teacherId}/invite/resend`, {}),
    onSuccess: (result, teacherId) => {
      setInviteResult((prev) => (prev && prev.teacherId === teacherId ? { ...result, teacherId } : prev));
      if (result.emailSent) toast.success(`Invite resent to ${result.email}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Upload helpers ────────────────────────────────────────────────────────
  async function uploadPhoto(
    file: File,
    setAssetId: (id: string) => void,
    setUrl: (url: string) => void,
    setUploading: (v: boolean) => void,
  ) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const asset = await api.request<MediaAsset>('/site/media?kind=STAFF', {
        method: 'POST',
        body: fd,
      });
      setAssetId(asset.id);
      setUrl(asset.url);
      void queryClient.invalidateQueries({ queryKey: ['site-media-staff'] });
      toast.success('Photo uploaded');
    } catch (err) {
      toast.error(`Photo upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  function resetAddForm() {
    setAddPhotoAssetId(null);
    setAddPhotoUrl(null);
  }

  function resetEditForm() {
    setEditPhotoAssetId(null);
    setEditPhotoUrl(null);
  }

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeleteTeacher(teacher: Teacher) {
    const ok = window.confirm(`Remove ${fullName(teacher)}? This can’t be undone.`);
    if (ok) deleteMutation.mutate(teacher.id);
  }

  const teachers = teachersQuery.data ?? [];
  const activeCount = teachers.filter((t) => t.isActive).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {inviteResult && (
        <InviteSentModal
          result={inviteResult}
          onClose={() => setInviteResult(null)}
          onResend={() => resendInviteMutation.mutate(inviteResult.teacherId)}
          resending={resendInviteMutation.isPending}
        />
      )}
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1>Teachers</h1>
          <p>Manage your school&apos;s teaching staff.</p>
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
              <Plus className="h-4 w-4" /> Add teacher
            </>
          )}
        </button>
      </header>

      {teachers.length > 0 && (
        <div className="sk-kpis" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          {/* Head-counts compared against each other — monospace + tabular
              so the digits sit on one grid instead of shifting as they load. */}
          <div className="sk-kpi">
            <span className="lab">Total teachers</span>
            <span className="n sk-num">{teachers.length}</span>
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
          <TeacherForm
            title="Add teacher"
            onSave={({ firstName, lastName, email, photoAssetId }) =>
              addMutation.mutate({
                firstName,
                lastName,
                email: email || undefined,
                photoAssetId: addPhotoAssetId ?? photoAssetId,
              })
            }
            isSaving={addMutation.isPending}
            onCancel={() => {
              setShowAdd(false);
              resetAddForm();
            }}
            onPhotoUpload={(f) =>
              void uploadPhoto(f, setAddPhotoAssetId, setAddPhotoUrl, setIsUploadingAddPhoto)
            }
            isUploadingPhoto={isUploadingAddPhoto}
            uploadedPhotoUrl={addPhotoUrl}
          />
        </div>
      )}

      {/* Loading / error states */}
      {teachersQuery.isLoading && <p className="sk-state">Loading…</p>}
      {teachersQuery.error && <p className="sk-state err">{(teachersQuery.error as Error).message}</p>}

      {/* Empty state */}
      {!teachersQuery.isLoading && teachers.length === 0 && (
        <p className="sk-state">No teachers yet. Add one above.</p>
      )}

      {/* Teacher grid */}
      {teachers.length > 0 && (
        <div className="sk-cardgrid">
          {teachers.map((teacher, i) =>
            editId === teacher.id ? (
              <TeacherForm
                key={teacher.id}
                title="Edit teacher"
                initial={teacher}
                photoUrl={teacher.photoAssetId ? (photoUrlMap[teacher.photoAssetId] ?? null) : null}
                onSave={({ firstName, lastName, email }) =>
                  updateMutation.mutate({
                    id: teacher.id,
                    firstName,
                    lastName,
                    email: email || undefined,
                    photoAssetId: editPhotoAssetId ?? teacher.photoAssetId ?? null,
                  })
                }
                isSaving={updateMutation.isPending}
                onCancel={() => {
                  setEditId(null);
                  resetEditForm();
                }}
                onPhotoUpload={(f) =>
                  void uploadPhoto(f, setEditPhotoAssetId, setEditPhotoUrl, setIsUploadingEditPhoto)
                }
                isUploadingPhoto={isUploadingEditPhoto}
                uploadedPhotoUrl={editPhotoUrl}
              />
            ) : (
              // `sk-pinin` on the one card just created: it drops in slightly
              // rotated and settles square, like a slip pinned to a board.
              // The grid is server-sorted, so a new entry can appear anywhere
              // in it — the gesture says WHERE, which the toast cannot.
              // Reduced motion collapses it to the settled card.
              <div
                key={teacher.id}
                className={teacher.id === justAddedId ? 'sk-entity sk-pinin sk-in' : 'sk-entity'}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {teacher.photoAssetId && photoUrlMap[teacher.photoAssetId] ? (
                    <img
                      src={photoUrlMap[teacher.photoAssetId]}
                      alt={fullName(teacher)}
                      style={{
                        height: 44,
                        width: 44,
                        borderRadius: 13,
                        objectFit: 'cover',
                        border: '1px solid var(--sk-line)',
                        flex: 'none',
                      }}
                    />
                  ) : (
                    <span className="av" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                      {initials(teacher)}
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{fullName(teacher)}</div>
                    {teacher.email && <div className="meta">{teacher.email}</div>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {!teacher.isActive && (
                        <span className="sk-pill" data-tone="warn">
                          Inactive
                        </span>
                      )}
                      {teacher.userId ? (
                        <span className="sk-pill" data-tone="good">
                          <CheckCircle2 className="h-3 w-3" style={{ display: 'inline', verticalAlign: '-2px' }} />{' '}
                          Has login
                        </span>
                      ) : (
                        <span className="sk-pill" data-tone="info">
                          No login yet
                        </span>
                      )}
                      {teacher.username && <span className="sk-pill" data-tone="info">@{teacher.username}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {teacher.userId ? (
                    <button
                      className="sk-btn sk-press"
                      disabled={resendInviteMutation.isPending}
                      onClick={() => resendInviteMutation.mutate(teacher.id)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Resend invite
                    </button>
                  ) : (
                    <button
                      className="sk-btn sk-press"
                      data-variant="primary"
                      disabled={createLoginMutation.isPending}
                      onClick={() => createLoginMutation.mutate(teacher.id)}
                      title={teacher.email ? undefined : 'Add an email to this teacher first'}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Create login
                    </button>
                  )}
                  <button
                    className="sk-btn sk-press"
                    onClick={() => {
                      setShowAdd(false);
                      setEditId(teacher.id);
                      resetEditForm();
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    className="sk-btn sk-press"
                    disabled={deleteMutation.isPending}
                    onClick={() => confirmDeleteTeacher(teacher)}
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
