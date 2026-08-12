'use client';

import { daysUntil, dueTone } from '@/lib/circulation';

/**
 * Green -> brass -> red as the due date nears; overdue pulses. Lives in
 * components/, not in a page file: Next only permits a default export plus its
 * own config exports from a page, and a stray named export fails `next build`
 * while passing tsc AND lint — the exact class scripts/preflight.sh exists for.
 */
export function DueRing({ dueAt }: { dueAt: string }) {
  const days = daysUntil(dueAt);
  const tone = dueTone(days);
  // 0 days left = full ring; clamp so a long loan does not underflow the dash.
  const frac = Math.max(0, Math.min(1, 1 - days / 14));
  const dash = 63;
  return (
    <svg className="lbx-ring" viewBox="0 0 24 24" role="img" aria-label={`${days} days`}>
      <circle className="lbx-ring-bg" cx="12" cy="12" r="10" />
      <circle
        className={`lbx-ring-fg ${tone}`}
        cx="12"
        cy="12"
        r="10"
        style={{ strokeDasharray: dash, strokeDashoffset: dash * (1 - frac) }}
      />
    </svg>
  );
}
