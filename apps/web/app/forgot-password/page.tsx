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
  const [code, setCode] = useState('');
  // Phase 5·1: a family often has the printed student code but not the email
  // it was issued against, so the code is a first-class way in here.
  const [mode, setMode] = useState<'email' | 'code'>('email');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  // Where the code-reset link actually went, masked by the server (or null
  // when that code has no email on file at all).
  const [sentTo, setSentTo] = useState<string | null>(null);

  const value = mode === 'email' ? email.trim() : code.trim().toUpperCase();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value || status === 'sending') return;
    setStatus('sending');
    try {
      if (mode === 'code') {
        const res = await api.post<{ ok: true; emailMasked: string | null }>(
          '/auth/reset-by-code',
          { code: value },
        );
        setSentTo(res.emailMasked);
      } else {
        await api.post('/auth/forgot-password', { email: value });
      }
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
              {mode === 'code' ? (
                <p data-testid="code-result">
                  {sentTo ? (
                    <>
                      We&rsquo;ve emailed a link to <b>{sentTo}</b>. It works once, and expires in 30
                      minutes.
                    </>
                  ) : (
                    <>
                      Student code <b>{value}</b> has no email on file, so there is nowhere to send a
                      link. Please ring the school office — they can set the password for you.
                    </>
                  )}
                </p>
              ) : (
                <p>
                  If an account exists for <b>{email.trim()}</b>, we&rsquo;ve emailed a link to reset the
                  password. The link is valid for 30 minutes.
                </p>
              )}
              <p className="text-slate-400">Not in the inbox? Check spam, or try again in a minute.</p>
              <a href="/login" className="inline-block text-teal-700 font-medium hover:underline">← Back to sign in</a>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div
                role="radiogroup"
                aria-label="Reset using"
                className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
              >
                {([
                  { value: 'email', label: 'My email' },
                  { value: 'code', label: 'Student code' },
                ] as const).map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === t.value}
                    data-testid={`mode-${t.value}`}
                    onClick={() => setMode(t.value)}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      mode === t.value
                        ? 'bg-white text-teal-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-slate-500">
                {mode === 'code'
                  ? 'Type the student code from your school letter and we\u2019ll send a reset link to the email on file.'
                  : 'Enter your email and we\u2019ll send you a link to set a new password.'}
              </p>
              {mode === 'code' ? (
                <div>
                  <Label htmlFor="code" required>Student code</Label>
                  <Input
                    id="code"
                    data-testid="code-input"
                    placeholder="RAF-00042"
                    autoComplete="off"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
              ) : (
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
              )}
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
