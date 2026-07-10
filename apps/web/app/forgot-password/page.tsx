'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';

export default function ForgotPasswordPage() {
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || status === 'sending') return;
    setStatus('sending');
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setStatus('sent');
    } catch {
      // Rate limit / transient failure — still no account enumeration.
      setStatus('error');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Forgot password</CardTitle>
          <CardDescription>{host?.split(':')[0]}</CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'sent' ? (
            <div className="space-y-4 text-sm text-slate-600">
              <p>
                If an account exists for <b>{email.trim()}</b>, we&rsquo;ve emailed a link to reset the
                password. The link is valid for 30 minutes.
              </p>
              <p className="text-slate-400">Not in the inbox? Check spam, or try again in a minute.</p>
              <a href="/login" className="inline-block text-teal-700 font-medium hover:underline">← Back to sign in</a>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <p className="text-sm text-slate-500">
                Enter your admin email and we&rsquo;ll send you a link to set a new password.
              </p>
              <div>
                <Label htmlFor="email" required>Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {status === 'error' && (
                <p className="text-xs text-rose-600">Couldn&rsquo;t send right now — please try again shortly.</p>
              )}
              <Button type="submit" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send reset link'}
              </Button>
              <a href="/login" className="text-center text-sm text-slate-500 hover:text-teal-700 transition">
                Back to sign in
              </a>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
