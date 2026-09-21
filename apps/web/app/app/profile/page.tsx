'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { PhoneCard } from '@/components/phone-card';
import { QueryError } from '@/components/ui/query-state';

/**
 * MY PROFILE — the admin's own page (design §5). Not Settings: Settings is
 * the school's, this is the person's. Four cards, in the order a new admin
 * needs them: who you are (name, login), your WhatsApp number, what reaches
 * you there, and your password.
 */
interface MeProfile {
  userId: string;
  role: string;
  email: string;
  name: string | null;
  notifyPrefs: Record<PrefKey, boolean>;
}
type PrefKey = 'leave' | 'register' | 'fees' | 'enquiry' | 'summary';

const PREFS: { key: PrefKey; label: string; hint: string }[] = [
  { key: 'leave', label: 'Leave requests', hint: 'A teacher asks for leave — Approve / Reject from the message.' },
  { key: 'register', label: 'Register change requests', hint: 'A teacher asks to reopen a past register.' },
  { key: 'fees', label: 'Fee payment proofs', hint: 'A family uploads a payment screenshot to verify.' },
  { key: 'enquiry', label: 'Admission enquiries', hint: 'A new enquiry from the website.' },
  { key: 'summary', label: 'Morning summary', hint: 'One message at 7:45 am with what needs you today.' },
];

const NEW_PASSWORD_MIN_LENGTH = 8;

export default function AdminProfilePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const key = ['me-profile', host];
  const q = useQuery({ queryKey: key, enabled: !!host, retry: false, queryFn: () => api.get<MeProfile>('/me/profile') });

  const [name, setName] = useState('');
  useEffect(() => { if (q.data) setName(q.data.name ?? ''); }, [q.data]);

  const save = useMutation({
    mutationFn: (patch: { name?: string; notifyPrefs?: Partial<Record<PrefKey, boolean>> }) => api.patch<MeProfile>('/me/profile', patch),
    onSuccess: (p, patch) => {
      qc.setQueryData(key, p);
      qc.invalidateQueries({ queryKey: ['me', host] });
      toast.success(patch.name !== undefined ? 'Saved.' : 'Updated.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => { setCurrentPassword(''); setNewPassword(''); toast.success('Password changed.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;
  const initials = (d?.name ?? d?.email ?? '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>My profile</h1>
        <p>Your name, your WhatsApp number, what reaches you there, and your password. School-wide settings live under Settings.</p>
      </header>

      {q.isError ? <QueryError error={q.error} onRetry={q.refetch} className="py-6" /> : null}

      <div className="mp-grid">
        <div className="sk-card" data-testid="profile-you">
          <div className="sk-card-h"><h3>You</h3>{d ? <span className="sk-pill" data-tone="neutral">{d.role === 'SCHOOL_ADMIN' ? 'Admin' : d.role}</span> : null}</div>
          <div className="sk-card-b">
            {q.isLoading || !d ? <p className="sk-state">Loading…</p> : (
              <form className="mp-form" onSubmit={(e) => { e.preventDefault(); save.mutate({ name }); }}>
                <div className="mp-who">
                  <div className="mp-avatar" aria-hidden="true">{initials}</div>
                  <div className="mp-who-t">
                    <div className="nm" style={{ fontSize: 15.5 }}>{d.name || 'No name yet'}</div>
                    <div className="mp-sub">{d.email}</div>
                  </div>
                </div>
                <label htmlFor="mp-name" className="sk-lab">Your name</label>
                <div className="ph-row">
                  <input id="mp-name" className="sk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Darshan Jain" maxLength={80} autoComplete="name" />
                  <button type="submit" className="sk-btn" data-variant="primary" disabled={save.isPending || name.trim() === (d.name ?? '')}>{save.isPending ? 'Saving…' : 'Save'}</button>
                </div>
                <p className="ph-hint">Shown as "approved by {name.trim() || 'you'}" on leave and register decisions.</p>
              </form>
            )}
          </div>
        </div>

        <PhoneCard role="admin" />

        <div className="sk-card" data-testid="profile-prefs">
          <div className="sk-card-h"><h3>What reaches you on WhatsApp</h3></div>
          <div className="sk-card-b">
            <p style={{ margin: '0 0 8px', fontSize: 13.5, color: 'var(--sk-ink-2)' }}>Everything is on until you switch it off. Off here means app and email only.</p>
            <ul className="mp-prefs">
              {PREFS.map((p) => (
                <li key={p.key}>
                  <label className="mp-pref">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={p.label}
                      checked={d?.notifyPrefs[p.key] ?? true}
                      disabled={!d || save.isPending}
                      onChange={(e) => save.mutate({ notifyPrefs: { [p.key]: e.target.checked } })}
                    />
                    <span><b>{p.label}</b><small>{p.hint}</small></span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="sk-card" data-testid="profile-password">
          <div className="sk-card-h"><h3>Change password</h3></div>
          <div className="sk-card-b">
            <form className="mp-form" onSubmit={(e) => { e.preventDefault(); if (newPassword.length >= NEW_PASSWORD_MIN_LENGTH) changePassword.mutate(); }}>
              <label htmlFor="mp-current" className="sk-lab">Current password</label>
              <input id="mp-current" className="sk-input" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              <label htmlFor="mp-new" className="sk-lab">New password</label>
              <input id="mp-new" className="sk-input" type="password" autoComplete="new-password" minLength={NEW_PASSWORD_MIN_LENGTH} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <div><button type="submit" className="sk-btn" data-variant="primary" disabled={changePassword.isPending || !currentPassword || newPassword.length < NEW_PASSWORD_MIN_LENGTH}>{changePassword.isPending ? 'Changing…' : 'Change password'}</button></div>
              <p className="ph-hint">Forgot it? Sign out and use "Forgot password" — a code comes to your verified WhatsApp number.</p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
