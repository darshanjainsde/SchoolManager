'use client';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvatarUploadResponse, TeacherProfile } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/** Mirrors ChangePasswordDto's `@MinLength(8)` on `newPassword`. */
const NEW_PASSWORD_MIN_LENGTH = 8;

/** Mirrors MAX_AVATAR_BYTES on POST /me/photo — checked client-side so an
 *  oversized pick fails instantly instead of after a doomed round-trip. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export default function TeacherProfilePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['t-profile'],
    enabled: !!host,
    queryFn: () => api.get<TeacherProfile>('/manage/teachers/me'),
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const changePassword = useMutation({
    mutationFn: (payload: ChangePasswordPayload) => api.post('/auth/change-password', payload),
    onSuccess: () => {
      setSuccessMessage('Password changed.');
      setClientError(null);
      setCurrentPassword('');
      setNewPassword('');
    },
    // A wrong-current-password error is the worst possible moment to wipe
    // what was typed — the fields are deliberately left exactly as they are.
    onError: () => {
      setSuccessMessage(null);
    },
  });

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    if (!file.type.startsWith('image/')) {
      setUploadError('Profile photos must be images.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setUploadError('Keep photos under 2MB.');
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // api.request, not api.post — post JSON-encodes every body; request
      // passes FormData through and skips Content-Type so fetch sets the
      // multipart boundary itself.
      const res = await api.request<AvatarUploadResponse>('/me/photo', {
        method: 'POST',
        body: fd,
      });
      queryClient.setQueryData<TeacherProfile>(['t-profile'], (prev) =>
        prev ? { ...prev, photoUrl: res.photoUrl } : prev,
      );
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);
    if (newPassword.length < NEW_PASSWORD_MIN_LENGTH) {
      setClientError(`New password must be at least ${NEW_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setClientError(null);
    changePassword.mutate({ currentPassword, newPassword });
  }

  const profile = profileQuery.data;
  // Server message verbatim (the { code, message } envelope), never the
  // client-side length check's own wording, which `clientError` already covers.
  const serverError = changePassword.isError ? (changePassword.error as Error).message : null;
  const formMessage = clientError ?? serverError;

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>My profile</h1>
        <p>Your teacher record (read-only) and account security.</p>
      </header>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Profile</h3>
        </div>
        <div className="sk-card-b">
          {profileQuery.isLoading && <p className="sk-state">Loading profile…</p>}
          {profileQuery.error && <p className="sk-state err">{(profileQuery.error as Error).message}</p>}
          {profile && (
            <div className="flex flex-col gap-3.5">
              {/* THE HEAD. On this page the photo IS the content — it is what
                  syncs to every roster, register and message thread in the
                  school — so it is centred and big rather than a 40px chip
                  beside a name. Same self-upload flow as the student portal
                  profile (POST /me/photo). */}
              <div className="sk-pfhead">
                <div className="sk-bigav">
                  {profile.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.photoUrl} alt={`${profile.firstName} ${profile.lastName}`} />
                  ) : (
                    initials(profile.firstName, profile.lastName)
                  )}
                </div>
                <div className="sk-pfname">
                  {profile.firstName} {profile.lastName}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Choose profile photo"
                  onChange={(e) => void handleFileChange(e)}
                />
                <button
                  type="button"
                  className="sk-btn sk-press"
                  style={{ marginTop: 12 }}
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploading ? 'Uploading…' : profile.photoUrl ? 'Change photo' : 'Add photo'}
                </button>
              </div>
              {uploadError && <p className="sk-state err">{uploadError}</p>}

              {/* Ruled rows with an icon tile, the way a form is filled in on
                  paper: what it is on the left, what it says on the right, a
                  rule between each. The tiles are decorative — every row is
                  already named by its label — so they are hidden from
                  assistive tech rather than read out as emoji. */}
              <div style={{ marginTop: 4 }}>
                <div className="sk-pfrow">
                  <span className="ic" aria-hidden="true">
                    ✉️
                  </span>
                  <span className="sk-lab">Email</span>
                  <span className="v">{profile.email ?? <span className="sk-muted">Not on file</span>}</span>
                </div>
                <div className="sk-pfrow">
                  <span className="ic" aria-hidden="true">
                    ☎️
                  </span>
                  <span className="sk-lab">Phone</span>
                  <span className="v">{profile.phone ?? <span className="sk-muted">Not on file</span>}</span>
                </div>
                <div className="sk-pfrow">
                  <span className="ic" aria-hidden="true">
                    📗
                  </span>
                  <span className="sk-lab">Subjects taught</span>
                  <span className="v">
                    {profile.subjects.length > 0 ? (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {profile.subjects.map((s) => (
                          <span className="sk-pill" data-tone="info" key={s}>
                            {s}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="sk-muted">No subjects assigned</span>
                    )}
                  </span>
                </div>
                <div className="sk-pfrow">
                  <span className="ic" aria-hidden="true">
                    🏫
                  </span>
                  <span className="sk-lab">Class teacher of</span>
                  <span className="v">
                    {profile.classTeacherOf.length > 0 ? (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {profile.classTeacherOf.map((c) => (
                          <span className="sk-pill" data-tone="good" key={c}>
                            {c}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="sk-muted">Not a class teacher</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Change password</h3>
        </div>
        <div className="sk-card-b">
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label htmlFor="current-password" className="sk-lab">
                Current password
              </label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                className={`${fieldCls} w-full`}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={changePassword.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-password" className="sk-lab">
                New password
              </label>
              {/* Mirrors ChangePasswordDto's @MinLength(8) — without this a
                  teacher can submit a short password and only learn it was
                  too short from a round-trip. */}
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                className={`${fieldCls} w-full`}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={NEW_PASSWORD_MIN_LENGTH}
                disabled={changePassword.isPending}
              />
            </div>
            {formMessage && <p className="sk-state err">{formMessage}</p>}
            {successMessage && <p className="sk-state">{successMessage}</p>}
            <div>
              <button
                type="submit"
                className="sk-btn sk-press"
                data-variant="primary"
                disabled={changePassword.isPending}
              >
                {changePassword.isPending ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
