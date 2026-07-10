'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setStatus('saving');
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setStatus('done');
    } catch (err) {
      setStatus('idle');
      setError((err as Error).message || 'This reset link is invalid or has expired — request a new one.');
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>{host?.split(':')[0]}</CardDescription>
      </CardHeader>
      <CardContent>
        {!token ? (
          <div className="space-y-4 text-sm text-slate-600">
            <p>This page needs a reset link from your email.</p>
            <a href="/forgot-password" className="inline-block text-teal-700 font-medium hover:underline">
              Request a reset link →
            </a>
          </div>
        ) : status === 'done' ? (
          <div className="space-y-4 text-sm text-slate-600">
            <p>✅ Your password has been changed. All other sessions were signed out.</p>
            <a href="/login" className="inline-block text-teal-700 font-medium hover:underline">
              Sign in with your new password →
            </a>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div>
              <Label htmlFor="password" required>New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
            </div>
            <div>
              <Label htmlFor="confirm" required>Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <Button type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      {/* useSearchParams requires a Suspense boundary during prerender */}
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
