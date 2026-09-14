'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { ApiError } from '@/lib/api';
import { useHost } from '@/components/use-host';
import {
  RECORDS_HOME_LAYOUTS, RECORDS_HOME_SCOPES, RECORDS_NAME_FORMATS, RECORDS_PAGE_STYLES,
  type RecordsLineIndexRow, type RecordsSiteConfig,
} from '@/components/public/records-config';
import type { StyleOption } from '@/components/public/celebrations-config';

interface Me { features?: string[] }

function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') return (err.body as { code?: string }).code;
  return undefined;
}

function Chips<T extends string>({ options, value, onPick, disabled }: { options: StyleOption<T>[]; value: T; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={disabled} title={o.hint} onClick={() => onPick(o.value)}
          className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700 border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-60">
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Cards<T extends string>({ options, value, onPick, disabled }: { options: StyleOption<T>[]; value: T; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={disabled} onClick={() => onPick(o.value)}
          className="rounded-xl border p-3 text-left transition aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50 border-slate-200 hover:border-slate-300 disabled:opacity-60">
          <div className="text-sm font-semibold text-slate-800">{o.label}</div>
          <div className="mt-0.5 text-xs text-slate-500">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="text-sm font-semibold text-slate-700">{label}</div>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {children}
    </div>
  );
}

/**
 * Website → Records: the Book of Records on the public site. The data is the
 * sports desk's — records the desk verified, marks from ranked heats. This
 * tab decides only whether it shows, under which names, in which room, and
 * which lines the homepage picks. The homepage BAND's look is a Studio band
 * (per-section layout → Book of Records), like every other band.
 */
export default function RecordsTab({ onGoToStudio }: { onGoToStudio: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const cfgQ = useQuery<RecordsSiteConfig>({ queryKey: ['site-records', host], enabled: !!host, queryFn: () => api.get('/site/records') });
  const linesQ = useQuery<RecordsLineIndexRow[]>({ queryKey: ['site-records-lines', host], enabled: !!host, queryFn: () => api.get('/site/records/lines') });
  const meQ = useQuery<Me>({ queryKey: ['me', host], enabled: !!host, staleTime: 5 * 60_000, queryFn: () => api.get('/auth/me') });
  const hasSports = meQ.data?.features?.includes('SPORTS') ?? false;
  const [draft, setDraft] = useState<RecordsSiteConfig | null>(null);
  useEffect(() => { if (cfgQ.data && !draft) setDraft(cfgQ.data); }, [cfgQ.data, draft]);

  const save = useMutation({
    mutationFn: (next: RecordsSiteConfig) => api.put<RecordsSiteConfig>('/site/records', next),
    onSuccess: (row) => { setDraft(row); qc.invalidateQueries({ queryKey: ['site-records'] }); toast.success('Saved — the website picks it up within a minute'); },
    onError: (err: Error) => toast.error(errorCode(err) === 'CONSENT_REQUIRED' ? err.message : `Could not save: ${err.message}`),
  });

  if (!draft) return <p className="py-8 text-sm text-slate-500">Opening the book…</p>;
  const lines = linesQ.data ?? [];
  const groups = [...new Map(lines.map((l) => [l.groupKey, l.label.split(' · ')[1]?.replace(/ (Boys|Girls|Mixed)$/, '') ?? l.groupKey])).entries()];
  const set = (p: Partial<RecordsSiteConfig>) => setDraft({ ...draft, ...p });
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfgQ.data);
  const withRecord = lines.filter((l) => l.hasRecord);

  return (
    <div className="grid gap-6">
      {!hasSports ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The Book of Records needs the Sports wing on this school. Everything below is read-only until it is switched on.
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Show the Book of Records on the website</h3>
            <p className="text-xs text-slate-500">A page at <span className="font-mono">/records</span> and a band on the homepage. Records come straight from the sports desk; nothing is typed twice.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" role="switch" aria-checked={draft.enabled} checked={draft.enabled} disabled={!hasSports} onChange={(e) => set({ enabled: e.target.checked })} />
            {draft.enabled ? 'On' : 'Off'}
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={draft.consentConfirmed} disabled={!hasSports} onChange={(e) => set({ consentConfirmed: e.target.checked })} />
          <span>The school may name its record holders on the public website (children’s names, the mark and the year — never a class, a photo or a date of birth).</span>
        </label>
        <Field label="Names on the page">
          <Chips options={RECORDS_NAME_FORMATS} value={draft.nameFormat} onPick={(v) => set({ nameFormat: v })} disabled={!hasSports} />
        </Field>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 grid gap-4">
        <h3 className="text-base font-semibold text-slate-800">The records page</h3>
        <Field label="Room" hint="How the full book is laid out at /records.">
          <Cards options={RECORDS_PAGE_STYLES} value={draft.pageLayout} onPick={(v) => set({ pageLayout: v })} disabled={!hasSports} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={draft.showTopFive} disabled={!hasSports} onChange={(e) => set({ showTopFive: e.target.checked })} />
          Show the all-time top five under each record (from every ranked heat, plus the book)
        </label>
        {groups.length > 1 ? (
          <Field label="Groups shown" hint="Untick a group to keep it off the website. Nothing ticked = every group.">
            <div className="flex flex-wrap gap-3">
              {groups.map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.groups.length === 0 || draft.groups.includes(key)} disabled={!hasSports}
                    onChange={(e) => {
                      const all = groups.map(([k]) => k);
                      const cur = draft.groups.length === 0 ? all : draft.groups;
                      const next = e.target.checked ? [...new Set([...cur, key])] : cur.filter((k) => k !== key);
                      set({ groups: next.length === all.length ? [] : next });
                    }} />
                  {label}
                </label>
              ))}
            </div>
          </Field>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-800">The homepage band</h3>
          <button type="button" onClick={onGoToStudio} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300">
            Band layout: Studio → Per-section layout <ExternalLink className="h-3 w-3" />
          </button>
        </div>
        <p className="text-xs text-slate-500">Four looks — {RECORDS_HOME_LAYOUTS.map((l) => l.label).join(', ')} — chosen in Studio like every other band, so it moves and animates with the rest of the page.</p>
        <Field label="Which lines the homepage shows" hint="Only lines with a verified record ever appear on the homepage; the page always shows everything.">
          <Chips options={RECORDS_HOME_SCOPES} value={draft.homeScope} onPick={(v) => set({ homeScope: v })} disabled={!hasSports} />
        </Field>
        {draft.homeScope === 'RECENT' ? (
          <Field label="How many">
            <Chips options={[{ value: '4', label: '4', hint: '' }, { value: '6', label: '6', hint: '' }, { value: '8', label: '8', hint: '' }]} value={String(draft.homeCount) as '4' | '6' | '8'} onPick={(v) => set({ homeCount: Number(v) as 4 | 6 | 8 })} disabled={!hasSports} />
          </Field>
        ) : null}
        {draft.homeScope === 'PINNED' ? (
          <Field label="Pinned lines" hint={withRecord.length ? 'Tick in the order you want them shown; a ticked line is added to the end.' : 'No line has a verified record yet — approve one on the sports desk first.'}>
            <div className="grid gap-1 sm:grid-cols-2">
              {withRecord.map((l) => (
                <label key={l.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.pinned.includes(l.key)} disabled={!hasSports}
                    onChange={(e) => set({ pinned: e.target.checked ? [...draft.pinned, l.key] : draft.pinned.filter((k) => k !== l.key) })} />
                  {l.label}
                  {draft.pinned.includes(l.key) ? <span className="ml-auto text-xs text-slate-400">#{draft.pinned.indexOf(l.key) + 1}</span> : null}
                </label>
              ))}
            </div>
          </Field>
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <button type="button" disabled={!dirty || save.isPending || !hasSports} onClick={() => save.mutate(draft)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <p className="text-xs text-slate-500">{lines.length} line{lines.length === 1 ? '' : 's'} in the book · {withRecord.length} with a verified record</p>
      </div>
    </div>
  );
}
