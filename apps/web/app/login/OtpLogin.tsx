'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * PHONE DOOR (design §4–§5). Three steps, one component: the number, the
 * six digits that arrived on WhatsApp, and — only when the number opens more
 * than one profile on this host — who to open as. Tokens go back to the
 * gatehouse through `onTokens`, which runs the same landing every login does.
 */
export interface OtpProfile {
  userId: string;
  kind: 'ADMIN' | 'TEACHER' | 'STAFF' | 'FAMILY';
  role: string;
  label: string;
  sub: string;
  schoolName: string;
  host: string;
}
interface Requested { challengeId: string; phoneMasked: string; sentVia: string[]; expiresIn: number }
type Verified =
  | { choose: true; ticket: string; profiles: OtpProfile[] }
  | ({ choose: false; accessToken: string; refreshToken?: string } & Record<string, unknown>);

export interface OtpApi {
  post<T>(path: string, body?: unknown): Promise<T>;
}

type Step = 'phone' | 'code' | 'choose';
const RESEND_AFTER_S = 60;

export function OtpLogin({ api, onTokens, disabled = false }: { api: OtpApi; onTokens: (t: { accessToken: string; refreshToken?: string }) => Promise<void>; disabled?: boolean }) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [req, setReq] = useState<Requested | null>(null);
  const [choice, setChoice] = useState<{ ticket: string; profiles: OtpProfile[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');

  async function send() {
    if (!phone.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<Requested>('/auth/otp/request', { phone: phone.trim() });
      setReq(r); setCode(''); setStep('code'); setLeft(RESEND_AFTER_S);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function verify() {
    if (!req || code.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<Verified>('/auth/otp/verify', { challengeId: req.challengeId, code });
      if (r.choose) { setChoice({ ticket: r.ticket, profiles: r.profiles }); setStep('choose'); }
      else await onTokens(r);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function choose(userId: string) {
    if (!choice || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ accessToken: string; refreshToken?: string }>('/auth/otp/choose', { ticket: choice.ticket, userId });
      await onTokens(r);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  if (step === 'choose' && choice) {
    return (
      <div className="gh-swap" data-testid="otp-choose">
        <p className="gh-label">Who are you opening for?</p>
        <p className="gh-hint">This number is on more than one profile here. You can switch later from the menu.</p>
        <div className="gh-choices" role="list">
          {choice.profiles.map((p) => (
            <button key={p.userId} type="button" role="listitem" className="gh-choice" disabled={busy || disabled} onClick={() => choose(p.userId)}>
              <span className="gh-choice-av" aria-hidden="true">{p.label.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}</span>
              <span className="gh-choice-t"><b>{p.label}</b><small>{p.sub} · {p.schoolName}</small></span>
            </button>
          ))}
        </div>
        {error && <p className="gh-error" role="alert">{error}</p>}
        <button type="button" className="gh-forgot" onClick={() => { setStep('phone'); setChoice(null); setError(null); }}>Use a different number</button>
      </div>
    );
  }

  if (step === 'code' && req) {
    return (
      <form className="gh-swap" data-testid="otp-code" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
        <div>
          <label className="gh-label" htmlFor="otp-code">The 6-digit code</label>
          <input
            id="otp-code"
            ref={codeRef}
            className="gh-input gh-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="482911"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={busy || disabled}
          />
          <p className="gh-hint">Sent to {req.phoneMasked} on {req.sentVia.length ? req.sentVia.map((v) => (v === 'sms' ? 'SMS' : 'WhatsApp')).join(' and ') : 'WhatsApp'}. It works for 10 minutes.</p>
          {error && <p className="gh-error" role="alert">{error}</p>}
        </div>
        <button type="submit" className={`gh-btn${busy ? ' gh-busy' : ''}`} disabled={busy || disabled || code.length !== 6}>
          {busy ? 'Checking…' : 'Open'}
        </button>
        <div className="gh-otp-links">
          <button type="button" className="gh-forgot" disabled={left > 0 || busy} onClick={() => void send()}>
            {left > 0 ? `Send again in ${left}s` : 'Send the code again'}
          </button>
          <button type="button" className="gh-forgot" onClick={() => { setStep('phone'); setError(null); }}>Change number</button>
        </div>
      </form>
    );
  }

  return (
    <form className="gh-swap" data-testid="otp-phone" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <div>
        <label className="gh-label" htmlFor="otp-phone">Mobile number</label>
        <input
          id="otp-phone"
          className="gh-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={busy || disabled}
        />
        <p className="gh-hint">The number the school has for you. A 6-digit code comes on WhatsApp — no password to remember.</p>
        {error && <p className="gh-error" role="alert">{error}</p>}
      </div>
      <button type="submit" className={`gh-btn${busy ? ' gh-busy' : ''}`} disabled={busy || disabled || !phone.trim()}>
        {busy ? 'Sending…' : 'Send code'}
      </button>
    </form>
  );
}
