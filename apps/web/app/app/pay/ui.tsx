'use client';
import type { ReactNode } from 'react';

/** Paise in, "₹24,500" out. Indian grouping; paise only when there are any. */
export function rupees(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = whole.toLocaleString('en-IN');
  return `${neg ? '−' : ''}₹${paise === 0 ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`}`;
}

/** "24500" typed by a person → paise. Empty is zero, not NaN. */
export function toMinor(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  return Math.round(Number(cleaned) * 100);
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number) => MONTHS[m - 1] ?? String(m);

export function apiErrorCode(e: unknown): string | null {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : null;
}

const RUN_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'good'> = {
  DRAFT: 'neutral', CALCULATED: 'info', APPROVED: 'warn', LOCKED: 'good', PAID: 'good',
};
const RUN_WORD: Record<string, string> = {
  DRAFT: 'Draft', CALCULATED: 'Worked out', APPROVED: 'Approved', LOCKED: 'Locked', PAID: 'Paid',
};

export function RunPill({ status }: { status: string }) {
  return <span className="sk-pill" data-tone={RUN_TONE[status] ?? 'neutral'}>{RUN_WORD[status] ?? status}</span>;
}

export function Kpi({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'warn' | 'good' | 'bad' }) {
  return (
    <div className="sk-kpi" data-tone={tone}>
      <span className="lab">{label}</span>
      <span className="n">{value}</span>
      {detail ? <span className="hint">{detail}</span> : null}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`sk-card ${className}`.trim()}>{children}</div>;
}
export function CardHead({ children }: { children: ReactNode }) {
  return <div className="sk-card-h">{children}</div>;
}
export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`sk-card-b ${className}`.trim()}>{children}</div>;
}
export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="sk-state">{children}</p>;
}

/**
 * A wide table scrolls inside its OWN box so the page body never scrolls
 * sideways — the console's rule, and the same shape the fees table uses.
 */
export function TableWrap({ minWidth = 620, children }: { minWidth?: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]" style={{ minWidth }}>{children}</table>
    </div>
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <th
      className={`p-2 text-[10px] font-bold uppercase tracking-[0.08em] ${right ? 'text-right' : 'text-left'}`}
      style={{ color: 'var(--sk-ink-3)', borderBottom: '1px solid var(--sk-line-2)', whiteSpace: 'nowrap' }}
    >
      {children}
    </th>
  );
}

/** A figure cell: right-aligned and tabular, so a column of rupees lines up. */
export function Td({ children, right, mono }: { children?: ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={`p-2 ${right ? 'text-right tabular-nums' : ''}`} style={mono ? { fontFamily: 'var(--sk-mono)' } : undefined}>
      {children}
    </td>
  );
}

/** Something the school should read before acting — never a bare paragraph of grey. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        borderLeft: '3px solid var(--sk-amber)', background: 'var(--sk-amber-tint)',
        padding: '10px 12px', borderRadius: '0 9px 9px 0', fontSize: 12.5, color: 'var(--sk-ink-2)',
        display: 'grid', gap: 4,
      }}
    >
      {children}
    </div>
  );
}

/**
 * "Rules current as at 22 September 2026" — shown on every screen that uses a
 * rate, not hidden in settings. A promise to keep every rate current forever
 * is one we cannot keep; saying when we last checked is the honest version,
 * and a school that knows can ask its accountant about anything newer.
 */
export function RulesAsAt({ asAt, version }: { asAt: string; version: string }) {
  return (
    <p className="sk-muted" style={{ fontSize: 12, marginTop: 6 }}>
      Rules current as at {new Date(`${asAt}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
      {' · '}rule book <span style={{ fontFamily: 'var(--sk-mono)' }}>{version}</span>
    </p>
  );
}

/** A download the browser makes from text we already hold — no extra round trip. */
export function downloadText(filename: string, body: string) {
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
