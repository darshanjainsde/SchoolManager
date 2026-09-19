'use client';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

/**
 * "Will this address take mail?" as the office types — the API's verdict,
 * debounced, advisory. Never blocks the form: a wrong address is the office's
 * call to make, this only makes sure they make it knowingly.
 */
export interface EmailVerdict {
  ok: boolean;
  normalized: string;
  reason?: 'SYNTAX' | 'TYPO' | 'NO_MAIL_SERVER' | 'DISPOSABLE' | 'BOUNCED_BEFORE';
  suggestion?: string;
  words: string;
}

export function useEmailCheck(value: string, opts: { enabled?: boolean; delayMs?: number } = {}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [verdict, setVerdict] = useState<EmailVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const last = useRef('');
  const enabled = opts.enabled ?? true;
  const delayMs = opts.delayMs ?? 500;

  useEffect(() => {
    const v = value.trim();
    // Nothing to say until it could be an address; and never re-ask for the same one.
    if (!enabled || !host || !v.includes('@') || v.length < 6) { setVerdict(null); setChecking(false); return; }
    if (v === last.current) return;
    let alive = true;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.post<EmailVerdict>('/manage/email-check', { email: v });
        if (alive) { last.current = v; setVerdict(r); }
      } catch {
        if (alive) setVerdict(null); // the check failing is never the office's problem
      } finally {
        if (alive) setChecking(false);
      }
    }, delayMs);
    return () => { alive = false; clearTimeout(t); };
    // `api` is a fresh object each render; host is the stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, host, enabled, delayMs]);

  return { verdict, checking };
}

/** The one line under an email input. Empty until there is something to say. */
export function EmailHint({ value, onFix }: { value: string; onFix?: (fixed: string) => void }) {
  const { verdict, checking } = useEmailCheck(value);
  if (!value.includes('@')) return null;
  if (checking && !verdict) return <div className="sk-email-hint" data-tone="neutral">Checking the address…</div>;
  if (!verdict) return null;
  if (verdict.ok) return <div className="sk-email-hint" data-tone="good" data-testid="email-hint">Looks fine.</div>;
  return (
    <div className="sk-email-hint" data-tone={verdict.reason === 'SYNTAX' ? 'neutral' : 'warn'} data-testid="email-hint">
      {verdict.words}
      {verdict.suggestion && onFix ? (
        <button type="button" className="sk-email-fix" onClick={() => onFix(verdict.suggestion!)}>Use {verdict.suggestion}</button>
      ) : null}
    </div>
  );
}
