'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { GatehouseStage } from '../login/GatehouseStage';
import type { LoginTheme } from '../login/gatehouse-theme';

/**
 * Set-a-new-password, wearing the same gatehouse as /login: the identity
 * panel, the living background, the inputs and the gate-open moment are all
 * the login page's own classes (login.css), so the invite/reset link a parent
 * or teacher follows lands somewhere that is recognisably their school — not
 * a bare card that could belong to any product. On success the gate overlay
 * plays and the visitor is carried to /login to sign in with the new password.
 */

function ResetForm({ theme }: { theme: LoginTheme }) {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return fail('Password must be at least 8 characters.');
    if (password !== confirm) return fail('Passwords do not match.');
    setStatus('saving');
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setStatus('done');
      // Let the gate-open moment play one beat, then hand over to sign-in.
      setTimeout(() => router.replace('/login'), 1600);
    } catch (err) {
      setStatus('idle');
      // Token-shaped validator messages ("token must be longer than…") are
      // for developers; the person holding a dead link needs the human line.
      const raw = (err as Error).message || '';
      fail(
        !raw || /token/i.test(raw)
          ? 'This link is invalid or has expired — request a new one below.'
          : raw,
      );
    }
  }
  function fail(message: string) {
    setError(message);
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  }

  return (
    <GatehouseStage
      theme={theme}
      plate="New password"
      foot={<>You&rsquo;re setting the password for the school&rsquo;s own system · {theme.hostname}</>}
      shaking={shaking}
      gate={{ open: status === 'done', title: 'Password set', sub: `Taking you to sign in · ${theme.schoolName}` }}
    >
      {!token ? (
        <div className="gh-form">
          <p className="gh-label gh-signin-as">Set a new password</p>
          <p className="gh-hint" style={{ marginBottom: 14 }}>
            This page needs the link from your email — open it again, or request a fresh one.
          </p>
          <a href="/forgot-password" className="gh-forgot">
            Request a reset link →
          </a>
        </div>
      ) : (
        <form className="gh-form" onSubmit={onSubmit}>
          <p className="gh-label gh-signin-as">Set a new password</p>
          <div className="gh-swap">
            <div>
              <label className="gh-label" htmlFor="password">
                New password
              </label>
              <input
                id="password"
                className="gh-input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="gh-hint">At least 8 characters.</p>
            </div>
            <div>
              <label className="gh-label" htmlFor="confirm">
                Confirm password
              </label>
              <input
                id="confirm"
                className="gh-input"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {error && <p className="gh-error">{error}</p>}
            </div>
            <button type="submit" className={`gh-btn${status === 'saving' ? ' gh-busy' : ''}`} disabled={status !== 'idle'}>
              {status === 'saving' ? 'Saving…' : 'Save new password'}
            </button>
          </div>
          <a href="/login" className="gh-forgot">
            Back to sign in
          </a>
          {theme.branded && (
            <p className="gh-powered">
              Powered by <b>Sckools</b>
            </p>
          )}
        </form>
      )}
    </GatehouseStage>
  );
}

export default function GatehouseReset({ theme }: { theme: LoginTheme }) {
  return (
    // useSearchParams requires a Suspense boundary during prerender.
    <Suspense fallback={null}>
      <ResetForm theme={theme} />
    </Suspense>
  );
}
