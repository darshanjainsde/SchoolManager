'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, login } from '@/lib/api';
import { saveSession } from '@/lib/session';

/**
 * The tenant comes from the browser's own hostname, so `raffles.library…`
 * logs into Raffles without anyone typing a school code — the same
 * wildcard-subdomain property the API's host resolution provides. On
 * localhost there is no subdomain to read, so a dev override is allowed;
 * it is deliberately NOT offered in the deployed app, where guessing a
 * tenant should not be a text field.
 */
function tenantHost(): string {
  if (typeof window === 'undefined') return '';
  const h = window.location.hostname;
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local');
  if (isLocal) return process.env.NEXT_PUBLIC_LIBRARY_DEV_HOST ?? 'raffles.library.trackyour.in';
  return h;
}

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const host = tenantHost();
    try {
      const { accessToken, refreshToken } = await login(host, identifier.trim(), password);
      saveSession({ accessToken, refreshToken, host });
      router.replace('/console');
    } catch (err) {
      // The API answers every failure — unknown user, wrong password, locked,
      // deactivated — with one message and one timing profile, deliberately.
      // Echoing its message rather than inventing a friendlier one keeps that
      // property intact; a client that distinguished them would undo it.
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a few minutes and try again.'
          : err instanceof ApiError
            ? err.message
            : 'Could not reach the library. Check your connection.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lbx-login">
      <form className="lbx-login-card" onSubmit={onSubmit} noValidate>
        <div className="lbx-brand" style={{ padding: 0 }}>
          <div className="lbx-tassel" aria-hidden="true">S</div>
          <div>
            <b>Sckools Library</b>
            <span>Sign in to the desk</span>
          </div>
        </div>

        <h1>Welcome back</h1>
        <p className="lbx-sub">Use the email or member code your library gave you.</p>

        {error ? (
          <div className="lbx-error" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="lbx-field">
          <label htmlFor="identifier">Email or member code</label>
          <input
            id="identifier"
            name="identifier"
            autoComplete="username"
            autoFocus
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </div>

        <div className="lbx-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="lbx-btn" type="submit" disabled={busy || !identifier || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
