'use client';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { TeacherProfile } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/** Mirrors ChangePasswordDto's `@MinLength(8)` on `newPassword`. */
const NEW_PASSWORD_MIN_LENGTH = 8;

interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export default function TeacherProfilePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

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
              <div>
                <div className="sk-lab">Name</div>
                <div className="nm" style={{ fontSize: 14.5, marginTop: 2 }}>
                  {profile.firstName} {profile.lastName}
                </div>
              </div>
              <div>
                <div className="sk-lab">Email</div>
                <div className="meta" style={{ marginTop: 2 }}>
                  {profile.email ?? <span className="sk-muted">Not on file</span>}
                </div>
              </div>
              <div>
                <div className="sk-lab">Phone</div>
                <div className="meta" style={{ marginTop: 2 }}>
                  {profile.phone ?? <span className="sk-muted">Not on file</span>}
                </div>
              </div>
              <div>
                <div className="sk-lab">Subjects taught</div>
                {profile.subjects.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {profile.subjects.map((s) => (
                      <span className="sk-pill" data-tone="info" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="sk-muted" style={{ marginTop: 4 }}>
                    No subjects assigned
                  </p>
                )}
              </div>
              <div>
                <div className="sk-lab">Class teacher of</div>
                {profile.classTeacherOf.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {profile.classTeacherOf.map((c) => (
                      <span className="sk-pill" data-tone="good" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="sk-muted" style={{ marginTop: 4 }}>
                    Not a class teacher
                  </p>
                )}
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
                className="sk-btn"
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
