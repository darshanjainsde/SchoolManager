'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/use-api';
import { Crest } from '../login/GatehouseLogin';
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
      fail((err as Error).message || 'This link is invalid or has expired — request a new one.');
    }
  }
  function fail(message: string) {
    setError(message);
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  }

  return (
    <div
      className="gh-stage"
      style={{ '--gh-p': theme.primary, '--gh-s': theme.secondary, '--gh-font': theme.fontStack } as React.CSSProperties}
    >
      <span className="gh-blob gh-b1" aria-hidden="true" />
      <span className="gh-blob gh-b2" aria-hidden="true" />
      <span className="gh-ring gh-r1" aria-hidden="true" />
      <span className="gh-ring gh-r2" aria-hidden="true" />
      <span className="gh-mote" style={{ left: '10%', top: '72%', animationDuration: '9s' }} aria-hidden="true" />
      <span className="gh-mote gh-mote-s" style={{ left: '22%', top: '88%', animationDuration: '12s', animationDelay: '2.5s' }} aria-hidden="true" />
      <span className="gh-mote" style={{ left: '48%', top: '94%', animationDuration: '10s', animationDelay: '5s' }} aria-hidden="true" />
      <span className="gh-mote gh-mote-s" style={{ left: '71%', top: '85%', animationDuration: '13s', animationDelay: '1.2s' }} aria-hidden="true" />
      <span className="gh-mote" style={{ left: '86%', top: '70%', animationDuration: '11s', animationDelay: '3.8s' }} aria-hidden="true" />

      <div className={`gh-shell${shaking ? ' gh-shake' : ''}`}>
        {/* ── Identity panel: the school half, same as sign-in ── */}
        <div className="gh-left">
          <div className="gh-left-top">
            <span className="gh-crest">
              <Crest theme={theme} />
            </span>
            <h1 className="gh-name" style={{ fontFamily: 'var(--gh-font)' }}>
              {theme.schoolName}
            </h1>
            <p className="gh-tagline">{theme.tagline}</p>
            <div className="gh-plate">
              <span className="gh-plate-text">New password</span>
            </div>
          </div>
          <span className="gh-watermark" aria-hidden="true">
            <Crest theme={theme} size={150} />
          </span>
          <p className="gh-foot">
            You&rsquo;re setting the password for the school&rsquo;s own system · {theme.hostname}
          </p>
        </div>

        {/* ── Form panel ── */}
        <div className="gh-right">
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
        </div>

        {/* ── Gate-open moment on success ── */}
        <div className={`gh-gate${status === 'done' ? ' gh-gate-on' : ''}`} aria-hidden={status !== 'done'}>
          <div className="gh-gate-inner">
            <span className="gh-gate-pulse" aria-hidden="true" />
            <Crest theme={theme} size={46} />
            <p className="gh-gate-title" style={{ fontFamily: 'var(--gh-font)' }}>
              Password set
            </p>
            <p className="gh-gate-sub">Taking you to sign in · {theme.schoolName}</p>
          </div>
        </div>
      </div>
    </div>
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
