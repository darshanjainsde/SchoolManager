'use client';
import { useState } from 'react';
import { REMAINING_WORK, STATUS_LABEL, type WorkStatus } from '@/lib/remaining-work';

/** Only tones the theme actually paints. */
const ITEM_TONE: Record<string, string> = { READY: 'good', BLOCKED: 'warn', PARTIAL: 'info' };

/**
 * What is still owed, per module.
 *
 * The shell now carries `.skosx` and a light/dark toggle, so this page uses
 * the console's own palette like every other one. It used to avoid sk-theme
 * deliberately, back when the shell pinned [color-scheme:light] and importing
 * the theme meant serving a dark palette into a light console.
 *
 * The list is a source file (lib/remaining-work.ts) rather than a table. It is
 * engineering state, so it belongs in review beside the code it describes and
 * closes in the same pull request as the work.
 */
export default function RemainingWorkPage() {
  const [filter, setFilter] = useState<WorkStatus | 'ALL'>('ALL');

  const shown = filter === 'ALL' ? REMAINING_WORK : REMAINING_WORK.filter((w) => w.status === filter);
  const byModule = shown.reduce<Record<string, typeof REMAINING_WORK>>((acc, w) => {
    (acc[w.module] ??= []).push(w);
    return acc;
  }, {});

  const count = (s: WorkStatus) => REMAINING_WORK.filter((w) => w.status === s).length;
  const blocked = REMAINING_WORK.filter((w) => w.status === 'BLOCKED');

  return (
    <>
      <header className="sk-own-head">
        <div>
          <h1>Remaining work</h1>
          <p>
            What each module still owes, and who it is waiting on. Edited in{' '}
            <code style={{ fontFamily: 'var(--sk-mono)', fontSize: 12 }}>apps/web/lib/remaining-work.ts</code>{' '}
            so an item closes in the pull request that finishes it.
          </p>
        </div>
      </header>

      <div className="sk-kpis" style={{ marginBottom: 18 }}>
        <div className="sk-kpi">
          <div className="sk-num">{REMAINING_WORK.length}</div>
          <div className="sk-lab">open items</div>
        </div>
        <div className="sk-kpi">
          <div className="sk-num" style={{ color: 'var(--sk-good)' }}>{count('READY')}</div>
          <div className="sk-lab">ready to build — nothing blocking</div>
        </div>
        <div className="sk-kpi">
          <div className="sk-num" style={{ color: 'var(--sk-amber-ink)' }}>{count('BLOCKED')}</div>
          <div className="sk-lab">waiting on a person or a third party</div>
        </div>
      </div>

      {blocked.length > 0 && (
        <div className="sk-own-panel" style={{ marginBottom: 18, borderColor: 'var(--sk-amber)' }}>
          <h2>Nothing moves on these until someone answers</h2>
          <ul style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none' }}>
            {blocked.map((w) => (
              <li key={w.id} style={{ fontSize: 13, padding: '3px 0' }}>
                <b>{w.blockedOn}</b>
                <span className="sk-muted"> — {w.title.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sk-own-tabs" role="tablist" aria-label="Filter by state">
        {(['ALL', 'READY', 'BLOCKED', 'PARTIAL'] as const).map((f) => {
          const n = f === 'ALL' ? REMAINING_WORK.length : count(f);
          if (n === 0 && f !== 'ALL') return null;
          return (
            <button key={f} type="button" role="tab" className="sk-own-tab"
              aria-selected={filter === f} onClick={() => setFilter(f)}>
              {f === 'ALL' ? 'Everything' : STATUS_LABEL[f]}
              <span className="n">{n}</span>
            </button>
          );
        })}
      </div>

      {Object.entries(byModule).map(([module, items]) => (
        <section key={module} style={{ marginBottom: 26 }}>
          <h2 className="sk-eyebrow" style={{ marginBottom: 9 }}>{module} · {items.length}</h2>
          {items.map((w) => (
            <article key={w.id} className="sk-own-order" data-tone={ITEM_TONE[w.status] ?? 'neutral'}>
              <div className="sk-own-order-top">
                <div style={{ minWidth: 0 }}>
                  <h3 className="sk-own-order-title" style={{ maxWidth: '62ch' }}>
                    {w.title}
                    <span className="sk-pill" data-tone={ITEM_TONE[w.status] ?? 'neutral'}>
                      {STATUS_LABEL[w.status]}
                    </span>
                  </h3>
                  <p className="sk-own-order-meta" style={{ maxWidth: '70ch', lineHeight: 1.55, marginTop: 6 }}>
                    {w.why}
                  </p>
                  <p className="sk-eyebrow" style={{ marginTop: 11 }}>What it needs</p>
                  <p className="sk-own-order-spec" style={{ maxWidth: '70ch', lineHeight: 1.55 }}>
                    {w.needs}
                  </p>
                  {w.blockedOn && (
                    <p className="sk-own-order-meta" style={{ marginTop: 9, color: 'var(--sk-amber-ink)', fontWeight: 700 }}>
                      Waiting on {w.blockedOn}
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      ))}

      {shown.length === 0 && (
        <p className="sk-own-state">
          <b>Nothing in that state.</b>
          Every item is in one of the other piles.
        </p>
      )}
    </>
  );
}
