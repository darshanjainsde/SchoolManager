'use client';
import { useState } from 'react';
import { REMAINING_WORK, STATUS_CLASS, STATUS_LABEL, type WorkStatus } from '@/lib/remaining-work';

/**
 * What is still owed, per module.
 *
 * Plain light-only Tailwind, NOT sk-theme: the console shell pins
 * [color-scheme:light] and carries no `.skosx`, so a page that imported the
 * theme would serve its dark palette to anyone on a dark-mode OS — which is
 * what /platform/scale currently does and is listed below as its own item.
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
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Remaining work</h1>
        <p className="mt-1 text-sm text-slate-500">
          What each module still owes, and who it is waiting on. Edited in
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-700">
            apps/web/lib/remaining-work.ts
          </code>
          so an item closes in the pull request that finishes it.
        </p>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-3xl font-bold tabular-nums text-slate-900">{REMAINING_WORK.length}</div>
          <div className="text-sm text-slate-500">open items</div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-3xl font-bold tabular-nums text-teal-600">{count('READY')}</div>
          <div className="text-sm text-slate-500">ready to build — nothing blocking</div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-3xl font-bold tabular-nums text-amber-600">{count('BLOCKED')}</div>
          <div className="text-sm text-slate-500">waiting on a person or a third party</div>
        </div>
      </div>

      {blocked.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-bold text-amber-900">Nothing moves on these until someone answers</h2>
          <ul className="mt-2 space-y-1">
            {blocked.map((w) => (
              <li key={w.id} className="text-sm text-amber-900">
                <span className="font-semibold">{w.blockedOn}</span>
                <span className="text-amber-700"> — {w.title.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {(['ALL', 'READY', 'BLOCKED', 'PARTIAL'] as const).map((f) => {
          const on = filter === f;
          const n = f === 'ALL' ? REMAINING_WORK.length : count(f);
          if (n === 0 && f !== 'ALL') return null;
          return (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={on}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset ${
                      on ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                    }`}>
              {f === 'ALL' ? 'Everything' : STATUS_LABEL[f]} · {n}
            </button>
          );
        })}
      </div>

      <div className="space-y-7">
        {Object.entries(byModule).map(([module, items]) => (
          <section key={module}>
            <h2 className="mb-2.5 text-sm font-bold uppercase tracking-wider text-slate-500">
              {module} · {items.length}
            </h2>
            <div className="space-y-3">
              {items.map((w) => (
                <article key={w.id} className="rounded-2xl bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="max-w-[62ch] text-[15px] font-bold text-slate-900">{w.title}</h3>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_CLASS[w.status]}`}>
                      {STATUS_LABEL[w.status]}
                    </span>
                  </div>

                  <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-slate-600">{w.why}</p>

                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">What it needs</div>
                    <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-slate-700">{w.needs}</p>
                  </div>

                  {w.blockedOn && (
                    <p className="mt-3 text-sm font-semibold text-amber-700">
                      Waiting on {w.blockedOn}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-slate-500">Nothing in that state.</p>
      )}
    </div>
  );
}
