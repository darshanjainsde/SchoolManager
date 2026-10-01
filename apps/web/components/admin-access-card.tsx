'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Overlay } from '@/components/ui/kit';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST, PLATFORM_HOST, schoolHref } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';

interface AdminRow {
  userId: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

export interface AdminAccessSchool {
  id: string;
  name: string;
  slug: string;
  primaryDomain: string | null;
}

/** Same floor as every other password path (auth dto, profile pages). */
const MIN = 8;

/** This school's own address: its primary domain, else its subdomain. */
function schoolHost(school: AdminAccessSchool): string {
  return school.primaryDomain ?? `${school.slug}.${PLATFORM_HOST}`;
}

/** Where this school's admins sign in. */
export function adminLoginUrl(school: AdminAccessSchool): string {
  return schoolHref(schoolHost(school), '/login');
}

/** The note the owner sends the admin. Plain text, so it pastes anywhere. */
export function handoverMessage(school: AdminAccessSchool, email: string, password: string): string {
  return [
    `Your ${school.name} admin password has been reset.`,
    '',
    `Sign in: ${adminLoginUrl(school)}`,
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    `After signing in, please set your own password under My profile → Change password: ${schoolHref(schoolHost(school), '/app/profile')}`,
  ].join('\n');
}

/**
 * Admin access for one school, in the owner console: who can sign in to the
 * school's console, and a way back in for any of them.
 *
 * Reset is a dialog, not a confirm(): the owner picks a generated password or
 * types one, sees it ONCE afterwards, and copies either the password or a
 * ready-to-send note that says where to sign in and how to change it. The
 * server signs the admin out everywhere and lifts any lockout.
 */
export function AdminAccessCard({ school }: { school: AdminAccessSchool }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const [target, setTarget] = useState<AdminRow | null>(null);

  const { data: admins, isLoading, error } = useQuery({
    queryKey: ['owner-school-admins', school.id],
    queryFn: () => api.get<AdminRow[]>(`/owner/schools/${school.id}/admins`),
    enabled: !!refreshToken,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin access</CardTitle>
        <CardDescription>
          The school&apos;s administrator logins. Reset a password when an admin is locked out or has forgotten it —
          they sign in with the new one and can change it from their profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="sk-muted">Loading admins…</p>}
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
            {(error as Error).message}
          </p>
        )}
        {admins && admins.length === 0 && (
          <p className="sk-muted">This school has no admin login yet — it is created with the school.</p>
        )}
        {admins && admins.length > 0 && (
          <div className="sk-tblwrap">
            <table className="sk-tbl">
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                  <th className="acts">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => {
                  const locked = a.lockedUntil ? new Date(a.lockedUntil) > new Date() : false;
                  return (
                    <tr key={a.userId}>
                      <td className="font-mono text-sm">{a.email}</td>
                      <td className="sk-muted">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('en-IN') : 'Never'}</td>
                      <td>
                        {!a.isActive ? (
                          <Badge tone="neutral">Inactive</Badge>
                        ) : locked ? (
                          <Badge tone="warning">Locked out</Badge>
                        ) : (
                          <Badge tone="success">Active</Badge>
                        )}
                      </td>
                      <td className="acts">
                        <Button size="sm" variant="outline" onClick={() => setTarget(a)}>
                          Reset password
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {target && <ResetDialog school={school} admin={target} onClose={() => setTarget(null)} />}
    </Card>
  );
}

function ResetDialog({
  school,
  admin,
  onClose,
}: {
  school: AdminAccessSchool;
  admin: AdminRow;
  onClose: () => void;
}) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [mode, setMode] = useState<'generate' | 'type'>('generate');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<{ password: string } | null>(null);

  const reset = useMutation({
    mutationFn: () =>
      api.post<{ password: string; generated: boolean }>(
        `/owner/schools/${school.id}/admins/${admin.userId}/reset-password`,
        mode === 'type' ? { password } : {},
      ),
    onSuccess: (res) => {
      setResult({ password: res.password });
      setPassword('');
      setConfirm('');
      // The lockout is lifted server-side; the table should say so.
      void qc.invalidateQueries({ queryKey: ['owner-school-admins', school.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tooShort = mode === 'type' && password.length > 0 && password.length < MIN;
  const mismatch = mode === 'type' && confirm.length > 0 && confirm !== password;
  const ready = mode === 'generate' || (password.length >= MIN && confirm === password);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Could not copy — select it and copy by hand.');
    }
  }

  return (
    <Overlay
      side="center"
      title={result ? 'Password reset' : 'Reset admin password'}
      subtitle={<span className="font-mono">{admin.email}</span>}
      onClose={onClose}
      footer={
        result ? (
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!ready || reset.isPending} onClick={() => reset.mutate()}>
              {reset.isPending ? 'Resetting…' : 'Reset password'}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3" role="status">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">New password — shown once</p>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <code className="select-all break-all font-mono text-base text-amber-950" data-testid="new-password">
                {result.password}
              </code>
              <Button size="sm" variant="outline" onClick={() => copy(result.password, 'Password')}>
                Copy password
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-slate-800">Message for the admin</p>
            <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-sans text-[13px] text-slate-700">
              {handoverMessage(school, admin.email, result.password)}
            </pre>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(handoverMessage(school, admin.email, result.password), 'Message')}
            >
              Copy message for admin
            </Button>
          </div>
          <p className="sk-muted">
            Their old password no longer works and every device they were signed in on has been signed out.
          </p>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex gap-2" role="group" aria-label="How to set it">
            <button
              type="button"
              className="sk-btn"
              aria-pressed={mode === 'generate'}
              onClick={() => setMode('generate')}
            >
              Generate a strong one
            </button>
            <button type="button" className="sk-btn" aria-pressed={mode === 'type'} onClick={() => setMode('type')}>
              I&apos;ll type one
            </button>
          </div>

          {mode === 'generate' ? (
            <p className="text-slate-600">
              A random 16-character password is created and shown to you once, to pass on to the admin.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="admin-pw">New password</Label>
                <Input
                  id="admin-pw"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={password}
                  minLength={MIN}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={tooShort || undefined}
                />
                <p className={tooShort ? 'text-xs text-rose-700' : 'text-xs text-slate-500'}>At least {MIN} characters.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-pw2">Type it again</Label>
                <Input
                  id="admin-pw2"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-invalid={mismatch || undefined}
                />
                {mismatch && <p className="text-xs text-rose-700">The two don&apos;t match.</p>}
              </div>
            </div>
          )}

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
            Their current password stops working straight away, they are signed out on every device, and a lockout
            from wrong attempts is lifted.
          </p>
        </div>
      )}
    </Overlay>
  );
}
