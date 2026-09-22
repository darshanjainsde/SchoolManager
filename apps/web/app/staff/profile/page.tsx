'use client';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { PhoneCard } from '@/components/phone-card';
import { QueryError } from '@/components/ui/query-state';

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/** Mirrors ChangePasswordDto's `@MinLength(8)` on `newPassword`. */
const NEW_PASSWORD_MIN_LENGTH = 8;

const STAFF_ROLE_LABEL: Record<string, string> = {
  OFFICE: 'Office staff',
  SUPPORT: 'Support staff',
  DRIVER: 'Driver',
  HELPER: 'Helper',
  SECURITY: 'Security',
  LIBRARIAN: 'Librarian',
  SPORTS: 'Sports teacher',
  OTHER: 'Staff',
};

interface Me {
  role: string;
  name: string | null;
  staffRole: string | null;
}

/**
 * THE STAFF PROFILE — the same three things the app's worker Profile holds:
 * who the school says you are, your WhatsApp number (where notices and OTP
 * codes go), and your password. Reachable by every STAFF kind, including
 * the librarian and the sports teacher whose home is a desk: `layout.tsx`
 * lets them onto this one page instead of bouncing them to their portal.
 */
export default function StaffProfilePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const me = useQuery({ queryKey: ['me'], enabled: !!host, queryFn: () => api.get<Me>('/auth/me') });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const changePassword = useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) => api.post('/auth/change-password', payload),
    onSuccess: () => {
      setSuccessMessage('Password changed.');
      setClientError(null);
      setCurrentPassword('');
      setNewPassword('');
    },
    // A wrong current password is the worst moment to wipe what was typed.
    onError: () => setSuccessMessage(null),
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

  const formMessage = clientError ?? (changePassword.isError ? (changePassword.error instanceof Error ? changePassword.error.message : 'Could not change the password.') : null);
  const name = me.data?.name?.trim() || 'Your school record';
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
      <div className="sk-card">
        <div className="sk-card-h"><h3>My profile</h3></div>
        <div className="sk-card-b">
          {me.isError ? <QueryError error={me.error} onRetry={me.refetch} className="py-4" /> : (
            <div className="flex items-center gap-3">
              <span className="badge" style={{ background: 'var(--sk-brand)', color: '#fff', width: 44, height: 44, fontSize: 15, borderRadius: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }} aria-hidden="true">{initials}</span>
              <div>
                <div className="nm" data-testid="staff-profile-name">{me.isPending ? 'Loading…' : name}</div>
                <div className="meta">{me.data ? (STAFF_ROLE_LABEL[me.data.staffRole ?? 'OTHER'] ?? 'Staff') : ''}</div>
              </div>
            </div>
          )}
          <p className="sk-muted" style={{ marginTop: 10 }}>Your name and role are your school&rsquo;s record. The office changes them.</p>
        </div>
      </div>

      <PhoneCard role="staff" />

      <div className="sk-card">
        <div className="sk-card-h"><h3>Change password</h3></div>
        <div className="sk-card-b">
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label htmlFor="current-password" className="sk-lab">Current password</label>
              <Input id="current-password" type="password" autoComplete="current-password" className={`${fieldCls} w-full`} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} disabled={changePassword.isPending} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-password" className="sk-lab">New password</label>
              <Input id="new-password" type="password" autoComplete="new-password" className={`${fieldCls} w-full`} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={NEW_PASSWORD_MIN_LENGTH} disabled={changePassword.isPending} />
            </div>
            {formMessage && <p className="sk-state err">{formMessage}</p>}
            {successMessage && <p className="sk-state">{successMessage}</p>}
            <div>
              <button type="submit" className="sk-btn sk-press" data-variant="primary" disabled={changePassword.isPending}>
                {changePassword.isPending ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
