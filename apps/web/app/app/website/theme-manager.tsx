'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';

/**
 * TEMPLATES, AND WHICH ONE IS LIVE — two questions, two cards.
 *
 * The old "Themes" card listed "Live site" as if it were one more theme, with
 * Save on some rows and Publish on others. A head teacher editing the Diwali
 * look pressed Save, saw nothing change on the website, pressed Publish on the
 * wrong row, and could not say afterwards which design visitors were seeing
 * (2026-09-27: "the save / publish / live structure is confusing").
 *
 * Now: the top card answers "what do visitors see right now, and how do I
 * change that" — one select, one button. The card below is where designs are
 * made: create a template, edit it, save it. Nothing in the second card
 * reaches a visitor until it is chosen in the first. The live design is never
 * edited directly; it is always "the template you put live".
 *
 * Which template is live is decided by CONTENT — the template whose saved
 * design equals the live design — not by a stored flag, so it cannot drift:
 * edit the live template and save, and it stops being marked live until you
 * put it live again, which is exactly what happened.
 *
 * Kept free of react-query so it can be rendered with plain props in a test;
 * the Studio owns the mutations.
 */
export type Look = Record<string, unknown>;
export interface TemplateRow {
  id: string;
  name: string;
  config: Record<string, unknown>;
  publishAt: string | null;
  revertAt: string | null;
  updatedAt?: string;
}

/** A stable string for a design, so two looks can be compared for equality. */
export function lookSig(l: Look): string {
  return JSON.stringify(Object.entries(l).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The template whose saved design IS the live design. Newest wins a tie (two
 * identical templates is a copy the school made; naming the recent one is the
 * less surprising answer). Null when the live design matches nothing — an
 * older site, or a template edited after it went live.
 */
export function liveTemplateId(templates: TemplateRow[], liveLook: Look, pick: (c: Record<string, unknown>) => Look): string | null {
  const live = lookSig(pick(liveLook));
  const hits = templates.filter((t) => lookSig(pick(t.config)) === live);
  if (hits.length === 0) return null;
  hits.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return hits[0].id;
}

/**
 * The scheduled template whose window contains `now` — what visitors are
 * ACTUALLY shown, because PublicSiteService overlays it at read time. This is
 * the one state that used to be invisible in the editor: a school with a
 * lapsed festival window saw "Live site: Default" here and Holi on the web.
 */
export function scheduledNow(templates: TemplateRow[], now: Date): TemplateRow | null {
  const t = now.getTime();
  const active = templates
    .filter((d) => d.publishAt && Date.parse(d.publishAt) <= t && (!d.revertAt || Date.parse(d.revertAt) > t))
    .sort((a, b) => Date.parse(b.publishAt!) - Date.parse(a.publishAt!));
  return active[0] ?? null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface ThemeManagerProps {
  templates: TemplateRow[];
  /** The live profile's design subset. */
  liveLook: Look;
  /** Projects any config to the design subset (the Studio's pickLook). */
  pickLook: (c: Record<string, unknown>) => Look;
  /** The template being edited, `'live'` while editing the live site's structure, or null. */
  activeId: string | null;
  /** Templates that hold unsaved edits. */
  unsavedIds: ReadonlySet<string>;
  /** The active template has unsaved edits. */
  dirty: boolean;
  /** Menu problems that block putting the ACTIVE template live. */
  navErrors: string[];
  busy: { saving?: boolean; creating?: boolean; publishing?: boolean };
  now?: Date;
  onOpen: (id: string) => void;
  onBackToTemplates: () => void;
  onSave: (id: string) => void;
  onDiscard: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onMakeLive: (id: string) => void;
  /** `from: 'live'` copies the live design; `'editing'` copies the template being edited. */
  onCreate: (name: string, from: 'live' | 'editing') => void;
  onSchedule: (id: string, body: { publishAt?: string | null; revertAt?: string | null }) => void;
}

export default function ThemeManager(p: ThemeManagerProps) {
  // One clock per render pass: a fresh Date in the deps would recompute every render.
  const now = useMemo(() => p.now ?? new Date(), [p.now]);
  const liveId = useMemo(() => liveTemplateId(p.templates, p.liveLook, p.pickLook), [p.templates, p.liveLook, p.pickLook]);
  const overlay = useMemo(() => scheduledNow(p.templates, now), [p.templates, now]);
  const upcoming = p.templates.filter((t) => t.publishAt && Date.parse(t.publishAt) > now.getTime());
  const liveName = liveId ? p.templates.find((t) => t.id === liveId)?.name ?? null : null;
  const editing = p.activeId && p.activeId !== 'live' ? p.templates.find((t) => t.id === p.activeId) ?? null : null;

  // The select defaults to something USEFUL: the template being edited if it
  // is not already live, else the first template that is not live.
  const firstChoice = (editing && editing.id !== liveId ? editing.id : null) ?? p.templates.find((t) => t.id !== liveId)?.id ?? p.templates[0]?.id ?? '';
  const [choiceRaw, setChoice] = useState<string>('');
  const choice = choiceRaw && p.templates.some((t) => t.id === choiceRaw) ? choiceRaw : firstChoice;
  const [newName, setNewName] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);

  return (
    <>
      {/* ── 1. What visitors see ── */}
      <Card className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Live site</h3>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">VISITORS SEE THIS</span>
        </div>
        <p className="mt-1.5 text-sm text-slate-700" data-testid="live-now">
          {liveName ? (
            <>Visitors see <b>{liveName}</b>.</>
          ) : (
            <>Visitors see a design that isn&rsquo;t saved as a template.</>
          )}
        </p>
        {!liveName && (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => p.onCreate('Current design', 'live')} disabled={p.busy.creating}>
            Save it as a template
          </Button>
        )}

        {overlay && (
          <div role="alert" className="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900" data-testid="schedule-overlay">
            <b>A schedule is overriding it.</b> Right now the website shows <b>{overlay.name}</b>
            {overlay.revertAt ? <> until {fmtDate(overlay.revertAt)}</> : <> with no end date</>}
            , whatever is chosen below. Remove the schedule to show the live template again.
            <div className="mt-1.5">
              <Button size="sm" variant="outline" onClick={() => p.onSchedule(overlay.id, { publishAt: null, revertAt: null })}>Remove schedule</Button>
            </div>
          </div>
        )}

        {p.templates.length > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
            <label htmlFor="live-choice" className="block text-[11px] font-bold uppercase tracking-wide text-slate-400">Put a template live</label>
            <div className="mt-1.5 flex gap-2">
              <Select id="live-choice" value={choice} onChange={(e) => setChoice(e.target.value)} className="h-8 min-w-0 flex-1 text-sm">
                {p.templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.id === liveId ? ' (live now)' : ''}</option>
                ))}
              </Select>
              <Button size="sm" onClick={() => choice && p.onMakeLive(choice)} disabled={!choice || choice === liveId || p.busy.publishing || (choice === p.activeId && p.navErrors.length > 0)}>
                {p.busy.publishing ? 'Putting live…' : 'Make live'}
              </Button>
            </div>
            {choice === p.activeId && p.navErrors.length > 0 && (
              <div role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
                <b>Fix this template&rsquo;s menu first:</b>
                <ul className="mt-1 list-disc pl-4">{p.navErrors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {choice && choice !== liveId && p.unsavedIds.has(choice) && (
              <p className="mt-1.5 text-[11px] text-amber-700">This template has unsaved edits — save it first, or the older saved version goes live.</p>
            )}
          </div>
        )}

        {upcoming.length > 0 && (
          <ul className="mt-2.5 flex flex-col gap-1 text-[11px] text-slate-500">
            {upcoming.map((t) => (
              <li key={t.id}>📅 <b>{t.name}</b> goes live {fmtDate(t.publishAt!)}{t.revertAt ? `, reverts ${fmtDate(t.revertAt)}` : ''}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── 2. Where designs are made ── */}
      <Card className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Templates{p.templates.length ? ` · ${p.templates.length}` : ''}</h3>
          {editing && (
            <span className={['rounded-full border px-2.5 py-0.5 text-[11px] font-bold',
              p.dirty ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-400'].join(' ')}>
              {p.dirty ? '● Unsaved changes' : '✓ Saved'}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">Design here. Nothing reaches visitors until you put a template live above.</p>

        {p.templates.length === 0 ? (
          <div className="mt-2.5 rounded-lg border border-dashed border-slate-300 p-3 text-center" data-testid="templates-empty">
            <p className="text-sm text-slate-600">No templates yet.</p>
            <Button size="sm" className="mt-2" onClick={() => p.onCreate('Current design', 'live')} disabled={p.busy.creating}>
              Save the live design as a template
            </Button>
          </div>
        ) : (
          <ul className="mt-2.5 flex list-none flex-col gap-1.5 p-0">
            {p.templates.map((t) => {
              const selected = p.activeId === t.id;
              return (
                <li key={t.id} className="flex flex-col">
                <button type="button" onClick={() => { p.onOpen(t.id); setShowSchedule(false); }} aria-pressed={selected}
                  className={['sk-press flex min-h-[40px] items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                    selected ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300'].join(' ')}>
                  <span className={`h-2 w-2 flex-none rounded-full ${t.id === liveId ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className="flex-1 truncate text-sm font-semibold text-slate-700">{t.name}</span>
                  {t.id === liveId && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">LIVE</span>}
                  {t.publishAt && <span className="text-[10px] text-slate-400">📅 {fmtDate(t.publishAt)}</span>}
                  {p.unsavedIds.has(t.id) && <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-400" title="Unsaved edits" aria-label="Unsaved edits" />}
                </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-2 flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New template name (e.g. Diwali ✨)" maxLength={80} className="h-8 text-sm" aria-label="New template name" />
          <Button size="sm" variant="outline" disabled={p.busy.creating}
            onClick={() => { p.onCreate(newName.trim() || 'New template', editing ? 'editing' : 'live'); setNewName(''); }}>
            + New template
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">{editing ? `Starts as a copy of “${editing.name}”.` : 'Starts as a copy of the live design.'}</p>

        {/* Editing the live site's STRUCTURE (band order, custom sections): a
            content job that never belongs to a template. Named plainly so it
            cannot be mistaken for editing the live look. */}
        {p.activeId === 'live' && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5" data-testid="editing-live-structure">
            <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Editing the live site&rsquo;s structure</div>
            <p className="mt-0.5 text-xs text-slate-600">Section order and your own sections are content, not design — they are saved straight to the live site below.</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={p.onBackToTemplates}>← Back to templates</Button>
          </div>
        )}

        {editing && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Editing</div>
            {/* Uncontrolled + commit on blur: renaming on every keystroke would
                round-trip to the server and jump the cursor. key resets it per template. */}
            <Input key={editing.id} defaultValue={editing.name} maxLength={80} aria-label="Template name"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== editing.name) p.onRename(editing.id, v); }}
              className="mt-0.5 h-8 text-sm font-semibold" />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => p.onSave(editing.id)} disabled={!p.dirty || p.busy.saving}>{p.busy.saving ? 'Saving…' : 'Save'}</Button>
              <Button size="sm" variant="outline" onClick={() => p.onDiscard(editing.id)} disabled={!p.dirty}>Discard</Button>
              {editing.id !== liveId && (
                <Button size="sm" variant="outline" onClick={() => p.onMakeLive(editing.id)} disabled={p.busy.publishing || p.navErrors.length > 0 || p.dirty}
                  title={p.dirty ? 'Save first' : undefined}>
                  Make live
                </Button>
              )}
              <button type="button" className="text-xs font-semibold text-rose-500 hover:text-rose-700" onClick={() => p.onDelete(editing.id)}>Delete</button>
            </div>
            {p.dirty && <p className="mt-1.5 text-[11px] text-slate-400">Save, then “Make live” — visitors only ever see a saved template.</p>}
            <button type="button" onClick={() => setShowSchedule((s) => !s)} aria-expanded={showSchedule}
              className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-slate-700">
              {showSchedule ? '▾' : '▸'} Put it live on a date (festival editions)
            </button>
            {showSchedule && (
              <div className="mt-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-500">Goes live on</label>
                    <input type="date" aria-label="Go live date" value={editing.publishAt ? editing.publishAt.slice(0, 10) : ''}
                      onChange={(e) => p.onSchedule(editing.id, { publishAt: e.target.value || null })}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-500">Reverts on</label>
                    <input type="date" aria-label="Revert date" value={editing.revertAt ? editing.revertAt.slice(0, 10) : ''}
                      onChange={(e) => p.onSchedule(editing.id, { revertAt: e.target.value || null })}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">Between those dates the website shows this template instead of the live one, by itself. Save your edits first — the scheduled version is the saved one.</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
