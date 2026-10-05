'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { GatehouseStage } from '../login/GatehouseStage';
import type { LoginTheme } from '../login/gatehouse-theme';

/**
 * Forgot password, in the same gatehouse as /login and /reset-password. It is
 * one click from the sign-in page, so it used to be the jarring step: the
 * login's school-branded, animated gate, then a grey card that could have
 * belonged to any product. The flows are unchanged:
 *
 *  - by EMAIL: a link always; plus a 6-digit WhatsApp/SMS code when that
 *    login has a phone on file, which can set the password right here;
 *  - by STUDENT CODE (Phase 5·1): a family often has the printed code but
 *    not the email it was issued against.
 *
 * No answer ever says whether an account exists.
 */
export default function GatehouseForgot({ theme }: { theme: LoginTheme }) {
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'email' | 'code'>('email');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  // Where the code-reset link actually went, masked by the server (or null
  // when that code has no email on file at all).
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Design §4: a login with a phone on file also gets a code on WhatsApp.
  const [otp, setOtp] = useState<{ challengeId: string; phoneMasked: string; sentVia: string[] } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpStatus, setOtpStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);

  function shake() {
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  }

  const value = mode === 'email' ? email.trim() : code.trim().toUpperCase();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value || status === 'sending') return;
    setStatus('sending');
    try {
      if (mode === 'code') {
        const res = await api.post<{ ok: true; emailMasked: string | null }>('/auth/reset-by-code', { code: value });
        setSentTo(res.emailMasked);
      } else {
        const r = await api.post<{ ok: true; challengeId?: string; phoneMasked?: string; sentVia?: string[] }>(
          '/auth/forgot-password',
          { email: value },
        );
        setOtp(
          r.challengeId && r.phoneMasked
            ? { challengeId: r.challengeId, phoneMasked: r.phoneMasked, sentVia: r.sentVia ?? ['whatsapp'] }
            : null,
        );
      }
      setStatus('sent');
    } catch {
      // Rate limit / transient failure — still no account enumeration.
      setStatus('error');
      shake();
    }
  }

  async function onResetWithOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otp || otpCode.length !== 6 || newPassword.length < 8 || otpStatus === 'saving') return;
    setOtpStatus('saving');
    setOtpError(null);
    try {
      await api.post('/auth/reset-with-otp', { email: email.trim(), challengeId: otp.challengeId, code: otpCode, newPassword });
      setOtpStatus('done');
    } catch (err) {
      setOtpStatus('error');
      setOtpError((err as Error).message);
      shake();
    }
  }

  const powered = theme.branded && (
    <p className="gh-powered">
      Powered by <b>Sckools</b>
    </p>
  );

  return (
    <GatehouseStage
      theme={theme}
      plate="Reset password"
      foot={<>You&rsquo;re resetting a password for the school&rsquo;s own system · {theme.hostname}</>}
      shaking={shaking}
      gate={{ open: otpStatus === 'done', title: 'Password set', sub: `Sign in with the new one · ${theme.schoolName}` }}
    >
      {status === 'sent' ? (
        <div className="gh-form">
          <p className="gh-label gh-signin-as">
            {mode === 'code' && !sentTo ? 'Nowhere to send it' : otp ? 'Check your phone' : 'Check your inbox'}
          </p>
          {mode === 'code' ? (
            <p className="gh-hint" data-testid="code-result" style={{ marginBottom: 14 }}>
              {sentTo ? (
                <>
                  We&rsquo;ve emailed a link to <b>{sentTo}</b>. It works once, and expires in 30 minutes.
                </>
              ) : (
                <>
                  Student code <b>{value}</b> has no email on file, so there is nowhere to send a link. Please ring the
                  school office — they can set the password for you.
                </>
              )}
            </p>
          ) : otpStatus === 'done' ? (
            <p className="gh-hint" data-testid="otp-done" style={{ marginBottom: 14 }}>
              Password changed. Every other session was signed out. Sign in with the new one.
            </p>
          ) : otp ? (
            <form className="gh-swap" data-testid="otp-reset" onSubmit={onResetWithOtp}>
              <p className="gh-hint">
                A 6-digit code went to <b>{otp.phoneMasked}</b> on{' '}
                {otp.sentVia.map((v) => (v === 'sms' ? 'SMS' : 'WhatsApp')).join(' and ')}, and a link to{' '}
                <b>{email.trim()}</b>. Use whichever arrives first.
              </p>
              <div>
                <label className="gh-label" htmlFor="otp-code">
                  The code
                </label>
                <input
                  id="otp-code"
                  className="gh-input gh-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="······"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </div>
              <div>
                <label className="gh-label" htmlFor="otp-new">
                  New password
                </label>
                <input
                  id="otp-new"
                  className="gh-input"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <p className="gh-hint">At least 8 characters.</p>
                {otpError && (
                  <p className="gh-error" role="alert">
                    {otpError}
                  </p>
                )}
              </div>
              <button
                type="submit"
                className={`gh-btn${otpStatus === 'saving' ? ' gh-busy' : ''}`}
                disabled={otpStatus === 'saving' || otpCode.length !== 6 || newPassword.length < 8}
              >
                {otpStatus === 'saving' ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          ) : (
            <p className="gh-hint" style={{ marginBottom: 14 }}>
              If an account exists for <b>{email.trim()}</b>, we&rsquo;ve emailed a link to reset the password. The
              link is valid for 30 minutes.
            </p>
          )}
          {otpStatus !== 'done' && <p className="gh-hint">Not in the inbox? Check spam, or try again in a minute.</p>}
          <a href="/login" className="gh-forgot">
            {otpStatus === 'done' ? 'Sign in →' : 'Back to sign in'}
          </a>
          {powered}
        </div>
      ) : (
        <form className="gh-form" onSubmit={onSubmit}>
          <p className="gh-label gh-signin-as">Forgot your password?</p>
          <div className="gh-modes" role="radiogroup" aria-label="Reset using">
            {(
              [
                ['email', 'My email'],
                ['code', 'Student code'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                data-testid={`mode-${m}`}
                className="gh-mode"
                onClick={() => setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="gh-swap" key={mode}>
            {mode === 'code' ? (
              <div>
                <label className="gh-label" htmlFor="code">
                  Student code
                </label>
                <input
                  id="code"
                  data-testid="code-input"
                  className="gh-input"
                  placeholder="RPS-00042"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
                <p className="gh-hint">
                  From your school letter. We&rsquo;ll send a reset link to the email on file.
                </p>
              </div>
            ) : (
              <div>
                <label className="gh-label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  className="gh-input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <p className="gh-hint">We&rsquo;ll send you a link to set a new password.</p>
              </div>
            )}
            {status === 'error' && <p className="gh-error">Couldn&rsquo;t send right now — please try again shortly.</p>}
            <button type="submit" className={`gh-btn${status === 'sending' ? ' gh-busy' : ''}`} disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send reset link'}
            </button>
          </div>
          <a href="/login" className="gh-forgot">
            Back to sign in
          </a>
          {powered}
        </form>
      )}
    </GatehouseStage>
  );
}
