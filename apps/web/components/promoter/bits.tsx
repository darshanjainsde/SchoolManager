'use client';
import type { ReactNode } from 'react';
import { QueryError } from '@/components/ui/query-state';
import { STAGE_LABEL, stageTone, type ReferralStatus } from '@/lib/promoter-session';

export function StagePill({ status }: { status: ReferralStatus }) {
  return <span className="sk-pill" data-tone={stageTone(status)}>{STAGE_LABEL[status]}</span>;
}

export function Tile({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="sk-kpi" data-tone={tone}>
      <span className="lab">{label}</span>
      <span className="n">{value}</span>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="sk-state" role="status">Loading {what}…</p>;
}

export function Failed({ error, onRetry }: { error: unknown; onRetry?: () => unknown }) {
  return <div className="sk-card"><div className="sk-card-b"><QueryError error={error} onRetry={onRetry} /></div></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="sk-card">
      <div className="sk-card-b" style={{ alignItems: 'center', textAlign: 'center', padding: '28px 18px' }}>
        <b style={{ fontSize: 15 }}>{title}</b>
        {children ? <p className="sk-muted" style={{ margin: 0, maxWidth: '44ch' }}>{children}</p> : null}
      </div>
    </div>
  );
}
