'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, Check, Plus, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import {
  FREQUENCY_LABEL, rupees, toMinor, toRupeeInput,
  type FeeCategory, type FeeGrid, type FeeTerm,
} from '@/lib/fees';

interface Year { id: string; name: string; isCurrent: boolean }

/**
 * Fee setup, in the order the work is actually done: what you charge for,
 * when it is due, how much per class, who is an exception.
 *
 * The person doing this is a school accounts clerk who keeps the fee structure
 * in a spreadsheet today. So step 3 IS a spreadsheet — classes down, categories
 * across, tab between cells, paste a column from Excel. The nearer this is to
 * the thing they already have, the shorter the training.
 */

const STEPS = [
  { id: 'categories', n: 'Step 1', t: 'Categories', d: 'What you charge for, and how you explain it' },
  { id: 'terms', n: 'Step 2', t: 'Terms', d: 'How many instalments and when each is due' },
  { id: 'amounts', n: 'Step 3', t: 'Class amounts', d: 'One number per class, per category' },
  { id: 'bills', n: 'Step 4', t: 'Generate bills', d: 'Preview the whole term, then commit' },
] as const;

export default function FeeSetupPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [step, setStep] = useState<(typeof STEPS)[number]['id']>('categories');

  const years = useQuery({
    queryKey: ['years', host], enabled: !!host,
    queryFn: () => api.get<Year[]>('/manage/years'),
  });
  const yearId = useMemo(
    () => years.data?.find((y) => y.isCurrent)?.id ?? years.data?.[0]?.id ?? '',
    [years.data],
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="sk-pagehead flex items-end justify-between">
        <div>
          <h1>Fee setup</h1>
          <p>Set this up once for the session. You can come back and change any step.</p>
        </div>
      </header>

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Setup steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            onClick={() => setStep(s.id)}
            aria-current={step === s.id ? 'step' : undefined}
            className="rounded-[11px] border p-3 text-left transition-colors"
            style={{
              borderColor: step === s.id ? 'var(--sk-brand)' : 'var(--sk-line)',
              background: step === s.id ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
            }}
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.09em]"
                 style={{ color: step === s.id ? 'var(--sk-brand-2)' : 'var(--sk-ink-3)' }}>{s.n}</div>
            <div className="mt-0.5 text-[13px] font-semibold">{s.t}</div>
            <div className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--sk-ink-3)' }}>{s.d}</div>
          </button>
        ))}
      </nav>

      {!yearId && years.isFetched && (
        <p className="sk-state err">Add an academic year under Classes before setting fees up.</p>
      )}

      {yearId && step === 'categories' && <CategoriesStep api={api} qc={qc} host={host} />}
      {yearId && step === 'terms' && <TermsStep api={api} qc={qc} host={host} yearId={yearId} />}
      {yearId && step === 'amounts' && <GridStep api={api} qc={qc} host={host} yearId={yearId} />}
      {yearId && step === 'bills' && <BillsStep api={api} qc={qc} host={host} yearId={yearId} />}
    </div>
  );
}

type Api = ReturnType<typeof useApi>;
type Qc = ReturnType<typeof useQueryClient>;
/** `useHost()` is undefined until mount; queries are gated on it above. */
type Host = string | undefined;

// ── Step 1 ───────────────────────────────────────────────────────────────────

function CategoriesStep({ api, qc, host }: { api: Api; qc: Qc; host: Host }) {
  const list = useQuery({
    queryKey: ['fee-categories', host], enabled: !!host,
    queryFn: () => api.get<FeeCategory[]>('/manage/fees/categories'),
  });

  const seed = useMutation({
    mutationFn: () => api.post<{ seeded: number }>('/manage/fees/categories/seed', {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fee-categories', host] });
      toast.success(r.seeded ? `Added ${r.seeded} categories to start from` : 'Your categories are already set up');
    },
  });

  const save = useMutation({
    mutationFn: (c: Partial<FeeCategory>) => api.put('/manage/fees/categories', c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-categories', host] }); toast.success('Saved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.del(`/manage/fees/categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-categories', host] }); toast.success('Removed'); },
  });

  // Seed on first arrival so the clerk never faces a blank page.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && list.isFetched && (list.data?.length ?? 0) === 0) {
      seeded.current = true;
      seed.mutate();
    }
  }, [list.isFetched, list.data, seed]);

  const [draft, setDraft] = useState<Partial<FeeCategory> | null>(null);

  if (list.isLoading) return <p className="sk-state">Loading your categories…</p>;

  return (
    <section className="sk-card">
      <div className="sk-card-h">
        <h3>What do you charge for?</h3>
        <p>
          The sentence you write here is shown to parents under the amount on their bill.
          It is the difference between a question and a phone call.
        </p>
      </div>
      <div className="sk-card-b">
        {list.data?.map((c) => (
          <div key={c.id} className="flex items-start gap-3 rounded-[11px] border p-3"
               style={{ borderColor: 'var(--sk-line)' }}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">{c.name}</span>
                <span className="sk-pill" data-tone="info">{FREQUENCY_LABEL[c.frequency]}</span>
                {c.isOptional && <span className="sk-pill" data-tone="neutral">opt-in only</span>}
                {!c.isCollectible && <span className="sk-pill" data-tone="warn">government-reimbursed</span>}
              </div>
              <p className="mt-1 text-[11.5px] leading-snug" style={{ color: 'var(--sk-ink-3)' }}>{c.description}</p>
            </div>
            <button className="sk-btn" onClick={() => setDraft(c)}>Edit</button>
            <button className="sk-btn" onClick={() => archive.mutate(c.id)} aria-label={`Remove ${c.name}`}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        <button
          className="sk-btn self-start"
          onClick={() => setDraft({ name: '', description: '', frequency: 'PER_TERM', isOptional: false, isCollectible: true, order: (list.data?.length ?? 0) })}
        >
          <Plus size={14} /> Add your own category
        </button>
      </div>

      {draft && (
        <CategoryDialog
          value={draft}
          onClose={() => setDraft(null)}
          onSave={(v) => { save.mutate(v); setDraft(null); }}
        />
      )}
    </section>
  );
}

function CategoryDialog({
  value, onClose, onSave,
}: { value: Partial<FeeCategory>; onClose: () => void; onSave: (v: Partial<FeeCategory>) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(20,18,36,0.45)' }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Fee category"
           className="sk-card w-full max-w-md">
        <div className="sk-card-h"><h3>{value.id ? 'Edit category' : 'New category'}</h3></div>
        <div className="sk-card-b">
          <label className="sk-lab" htmlFor="cat-name">Name</label>
          <input id="cat-name" className="sk-input" value={v.name ?? ''}
                 onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Tuition" />

          <label className="sk-lab" htmlFor="cat-desc">What parents will read</label>
          <input id="cat-desc" className="sk-input" value={v.description ?? ''}
                 onChange={(e) => setV({ ...v, description: e.target.value })}
                 placeholder="Classroom teaching, learning materials and school upkeep" />
          <p className="text-[11px]" style={{ color: 'var(--sk-ink-3)' }}>
            Shown on every bill, right under the amount.
          </p>

          <label className="sk-lab" htmlFor="cat-freq">How often</label>
          <select id="cat-freq" className="sk-input" value={v.frequency ?? 'PER_TERM'}
                  onChange={(e) => setV({ ...v, frequency: e.target.value as FeeCategory['frequency'] })}>
            <option value="PER_TERM">Every term</option>
            <option value="ANNUAL">Once a year</option>
            <option value="ONE_TIME">One time, when a student joins</option>
          </select>

          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={v.isOptional ?? false}
                   onChange={(e) => setV({ ...v, isOptional: e.target.checked })} />
            Only charge students who opt in (like the bus)
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={!(v.isCollectible ?? true)}
                   onChange={(e) => setV({ ...v, isCollectible: !e.target.checked })} />
            Reimbursed by the government (RTE) — never chased from parents
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t p-3" style={{ borderColor: 'var(--sk-line)' }}>
          <button className="sk-btn" onClick={onClose}>Cancel</button>
          <button className="sk-btn" data-variant="primary"
                  disabled={!v.name?.trim() || !v.description?.trim()}
                  onClick={() => onSave(v)}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Step 2 ───────────────────────────────────────────────────────────────────

const TERM_PRESETS: { label: string; names: string[] }[] = [
  { label: 'Once a year', names: ['Annual'] },
  { label: 'Two terms', names: ['Term 1', 'Term 2'] },
  { label: 'Four terms', names: ['Term 1', 'Term 2', 'Term 3', 'Term 4'] },
];

function TermsStep({ api, qc, host, yearId }: { api: Api; qc: Qc; host: Host; yearId: string }) {
  const list = useQuery({
    queryKey: ['fee-terms', host, yearId], enabled: !!host,
    queryFn: () => api.get<FeeTerm[]>(`/manage/fees/terms?academicYearId=${yearId}`),
  });

  const [rows, setRows] = useState<{ id?: string; name: string; dueDate: string }[]>([]);
  useEffect(() => {
    if (list.data) setRows(list.data.map((t) => ({ id: t.id, name: t.name, dueDate: t.dueDate.slice(0, 10) })));
  }, [list.data]);

  const save = useMutation({
    mutationFn: () => api.put('/manage/fees/terms', { academicYearId: yearId, terms: rows }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-terms', host, yearId] }); toast.success('Terms saved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (list.isLoading) return <p className="sk-state">Loading terms…</p>;

  return (
    <section className="sk-card">
      <div className="sk-card-h">
        <h3>When is the fee due?</h3>
        <p>Each term is one instalment with one due date. Parents see the date on their bill.</p>
      </div>
      <div className="sk-card-b">
        {rows.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {TERM_PRESETS.map((p) => (
              <button key={p.label} className="sk-btn"
                      onClick={() => setRows(p.names.map((n) => ({ name: n, dueDate: '' })))}>
                {p.label}
              </button>
            ))}
          </div>
        )}

        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[140px] flex-1">
              <label className="sk-lab" htmlFor={`term-name-${i}`}>Name</label>
              <input id={`term-name-${i}`} className="sk-input" value={r.name}
                     onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            </div>
            <div className="min-w-[150px] flex-1">
              <label className="sk-lab" htmlFor={`term-due-${i}`}>Due on</label>
              <input id={`term-due-${i}`} type="date" className="sk-input" value={r.dueDate}
                     onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x))} />
            </div>
            <button className="sk-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    aria-label={`Remove ${r.name || 'term'}`}><Trash2 size={14} /></button>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <button className="sk-btn" onClick={() => setRows([...rows, { name: `Term ${rows.length + 1}`, dueDate: '' }])}>
            <Plus size={14} /> Add a term
          </button>
          <button className="sk-btn" data-variant="primary"
                  disabled={save.isPending || rows.some((r) => !r.name.trim() || !r.dueDate)}
                  onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save terms'}
          </button>
        </div>
        {rows.some((r) => !r.dueDate) && (
          <p className="text-[11.5px]" style={{ color: 'var(--sk-ink-3)' }}>Every term needs a due date before you can save.</p>
        )}
      </div>
    </section>
  );
}

// ── Step 3 · the grid ────────────────────────────────────────────────────────

/**
 * Classes down, categories across. Deliberately the shape of the spreadsheet
 * the clerk already keeps, so the translation cost is zero.
 *
 * Edits are held locally until Save: a grid that writes on every keystroke
 * makes "I typed the wrong number in the wrong row" unrecoverable, and this is
 * the screen where that mistake is most likely and most expensive.
 */
function GridStep({ api, qc, host, yearId }: { api: Api; qc: Qc; host: Host; yearId: string }) {
  const grid = useQuery({
    queryKey: ['fee-grid', host, yearId], enabled: !!host,
    queryFn: () => api.get<FeeGrid>(`/manage/fees/grid?academicYearId=${yearId}`),
  });

  /** `${gradeId}|${categoryId}` → rupee string, as typed. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!grid.data) return;
    const next: Record<string, string> = {};
    for (const c of grid.data.cells) {
      if (c.termId !== null) continue; // per-term overrides are edited on the row expander
      next[`${c.gradeId}|${c.categoryId}`] = toRupeeInput(c.amountMinor);
    }
    setEdits(next);
    setDirty(false);
  }, [grid.data]);

  const save = useMutation({
    mutationFn: () => {
      const cells = Object.entries(edits)
        .map(([k, v]) => {
          const [gradeId, categoryId] = k.split('|');
          return { gradeId, categoryId, termId: null, amountMinor: toMinor(v) };
        })
        .filter((c) => c.amountMinor > 0);
      return api.put<{ planVersion: number; cells: number }>('/manage/fees/grid', { academicYearId: yearId, cells });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fee-grid', host, yearId] });
      setDirty(false);
      toast.success(
        r.planVersion > 1
          ? `Saved as version ${r.planVersion} — bills already sent keep their old amounts`
          : 'Fee amounts saved',
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = grid.data;
  const termCount = d?.terms.length ?? 0;

  const totalFor = (gradeId: string) =>
    (d?.categories ?? []).reduce((a, c) => a + toMinor(edits[`${gradeId}|${c.id}`] ?? ''), 0);

  /** Copy the top non-empty value in a column down to every class below it. */
  const fillDown = (categoryId: string) => {
    if (!d) return;
    const first = d.grades.find((g) => (edits[`${g.id}|${categoryId}`] ?? '').trim() !== '');
    if (!first) { toast.error('Type an amount in the first class, then fill down.'); return; }
    const value = edits[`${first.id}|${categoryId}`];
    const next = { ...edits };
    let seen = false;
    for (const g of d.grades) {
      if (g.id === first.id) { seen = true; continue; }
      if (seen) next[`${g.id}|${categoryId}`] = value;
    }
    setEdits(next); setDirty(true);
  };

  if (grid.isLoading || !d) return <p className="sk-state">Loading the fee grid…</p>;
  if (d.grades.length === 0) return <p className="sk-state err">Add classes before setting fee amounts.</p>;
  if (d.categories.length === 0) return <p className="sk-state err">Add fee categories in step 1 first.</p>;

  return (
    <section className="sk-card">
      <div className="sk-card-h">
        <h3>Fee per class</h3>
        <p>
          Amounts are <strong>per term</strong>
          {termCount > 0 && <> — this session has {termCount} {termCount === 1 ? 'term' : 'terms'}</>}.
          Tab moves across, and the totals on the right update as you type.
        </p>
      </div>

      {d.isFrozen && (
        <div className="mx-4 rounded-[11px] border p-3 text-[12px]"
             style={{ borderColor: 'var(--sk-amber)', background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)' }}>
          Bills have already gone out from version {d.planVersion}. Changing an amount here saves a
          new version and affects only bills you generate from now on — nothing a parent has already
          seen will change.
        </div>
      )}

      <div className="sk-card-b">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 p-2 text-left text-[10px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: 'var(--sk-ink-3)', background: 'var(--sk-card)' }}>Class</th>
                {d.categories.map((c) => (
                  <th key={c.id} className="p-2 text-right text-[10px] font-bold uppercase tracking-[0.08em]"
                      style={{ color: 'var(--sk-ink-3)' }}>
                    <div className="whitespace-nowrap">{c.name}</div>
                    <button className="mt-0.5 inline-flex items-center gap-1 text-[9.5px] font-semibold normal-case tracking-normal"
                            style={{ color: 'var(--sk-brand-2)' }}
                            onClick={() => fillDown(c.id)}
                            title={`Copy the first amount down every class`}>
                      <ArrowDown size={10} /> fill down
                    </button>
                  </th>
                ))}
                <th className="p-2 text-right text-[10px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: 'var(--sk-ink-3)' }}>Per term</th>
              </tr>
            </thead>
            <tbody>
              {d.grades.map((g) => (
                <tr key={g.id} style={{ borderTop: '1px solid var(--sk-line)' }}>
                  <td className="sticky left-0 z-10 p-2"
                      style={{ background: 'var(--sk-bg-2)', borderRight: '1px solid var(--sk-line)' }}>
                    <div className="whitespace-nowrap font-semibold">{g.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--sk-ink-3)' }}>
                      {g.studentCount} {g.studentCount === 1 ? 'student' : 'students'}
                    </div>
                  </td>
                  {d.categories.map((c) => {
                    const key = `${g.id}|${c.id}`;
                    return (
                      <td key={c.id} className="p-0" style={{ borderLeft: '1px solid var(--sk-line)' }}>
                        <input
                          inputMode="decimal"
                          aria-label={`${c.name} for ${g.name}`}
                          value={edits[key] ?? ''}
                          onChange={(e) => { setEdits({ ...edits, [key]: e.target.value }); setDirty(true); }}
                          placeholder="—"
                          className="w-full bg-transparent p-2 text-right tabular-nums outline-none focus:bg-[var(--sk-brand-tint)]"
                          style={{ minWidth: 78, color: 'var(--sk-ink)' }}
                        />
                      </td>
                    );
                  })}
                  <td className="p-2 text-right font-semibold tabular-nums"
                      style={{ background: 'var(--sk-bg-2)' }}>{rupees(totalFor(g.id))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="sk-btn" data-variant="primary" disabled={save.isPending || !dirty}
                  onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : dirty ? 'Save fee amounts' : <><Check size={14} /> Saved</>}
          </button>
          {d.categories.some((c) => c.isOptional) && (
            <p className="text-[11.5px]" style={{ color: 'var(--sk-ink-3)' }}>
              {d.categories.filter((c) => c.isOptional).map((c) => c.name).join(', ')} —
              only billed to students who opt in.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Step 4 · generate ────────────────────────────────────────────────────────

/**
 * Preview then commit. The preview runs the exact computation `generate` will
 * run — same endpoint family, same code path on the server — so what the clerk
 * approves is what is written. Nothing here is a separate estimate.
 */
function BillsStep({ api, qc, host, yearId }: { api: Api; qc: Qc; host: Host; yearId: string }) {
  const terms = useQuery({
    queryKey: ['fee-terms', host, yearId], enabled: !!host,
    queryFn: () => api.get<FeeTerm[]>(`/manage/fees/terms?academicYearId=${yearId}`),
  });
  const [termId, setTermId] = useState('');
  useEffect(() => { if (!termId && terms.data?.length) setTermId(terms.data[0].id); }, [terms.data, termId]);

  const preview = useQuery({
    queryKey: ['fee-preview', host, termId], enabled: !!host && !!termId, retry: false,
    queryFn: () => api.get<import('@/lib/fees').BillingPreview>(`/manage/fees/billing/preview?termId=${termId}`),
  });

  const generate = useMutation({
    mutationFn: () => api.post<{ created: number; skipped: number }>('/manage/fees/billing/generate', { termId }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fee-preview', host, termId] });
      qc.invalidateQueries({ queryKey: ['fee-summary', host] });
      toast.success(
        r.created === 0
          ? 'Every student already has a bill for this term — nothing to do'
          : `${r.created} bills issued`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const p = preview.data;

  return (
    <section className="sk-card">
      <div className="sk-card-h">
        <h3>Generate bills</h3>
        <p>See the whole term before you commit. Running this twice never bills anyone twice.</p>
      </div>
      <div className="sk-card-b">
        <div>
          <label className="sk-lab" htmlFor="bill-term">Term</label>
          <select id="bill-term" className="sk-input" value={termId} onChange={(e) => setTermId(e.target.value)}>
            {terms.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {preview.error && <p className="sk-state err">{(preview.error as Error).message}</p>}
        {preview.isLoading && <p className="sk-state">Working out the bills…</p>}

        {p && (
          <>
            <div className="sk-kpis">
              <div className="sk-kpi"><div className="lab">To bill now</div><div className="n">{p.toBill}</div>
                <div className="hint">of {p.students} students</div></div>
              <div className="sk-kpi"><div className="lab">Total</div><div className="n">{rupees(p.totalMinor)}</div>
                <div className="hint">{rupees(p.collectibleMinor)} collectible</div></div>
              <div className="sk-kpi" data-tone={p.alreadyBilled ? 'warn' : undefined}>
                <div className="lab">Already billed</div><div className="n">{p.alreadyBilled}</div>
                <div className="hint">will be skipped</div></div>
              <div className="sk-kpi"><div className="lab">RTE students</div><div className="n">{p.rteStudents}</div>
                <div className="hint">billed, never chased</div></div>
            </div>

            {p.skippedNoPlan > 0 && (
              <p className="text-[11.5px]" style={{ color: 'var(--sk-amber-ink)' }}>
                {p.skippedNoPlan} {p.skippedNoPlan === 1 ? 'student has' : 'students have'} no fee amount set for
                their class — check step 3 before generating, or they will not be billed at all.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]" style={{ minWidth: 460 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sk-line-2)' }}>
                    {['Student', 'Class', 'Lines', 'Amount', ''].map((h) => (
                      <th key={h} className="p-2 text-left text-[10px] font-bold uppercase tracking-[0.08em]"
                          style={{ color: 'var(--sk-ink-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.invoices.slice(0, 25).map((inv) => (
                    <tr key={inv.studentId} style={{ borderTop: '1px solid var(--sk-line)' }}>
                      <td className="p-2">
                        <div className="font-semibold">{inv.studentName}</div>
                        <div className="text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>{inv.admissionNo}</div>
                      </td>
                      <td className="p-2">{inv.gradeName}</td>
                      <td className="p-2 text-[11px]" style={{ color: 'var(--sk-ink-3)' }}>
                        {inv.lines.map((l) => l.categoryName).join(' · ')}
                      </td>
                      <td className="p-2 text-right font-semibold tabular-nums">{rupees(inv.totalMinor)}</td>
                      <td className="p-2">
                        {inv.alreadyBilled
                          ? <span className="sk-pill" data-tone="neutral">already billed</span>
                          : inv.isRte ? <span className="sk-pill" data-tone="warn">RTE</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {p.invoices.length > 25 && (
              <p className="text-[11.5px]" style={{ color: 'var(--sk-ink-3)' }}>
                Showing the first 25 of {p.invoices.length}. All of them are included when you generate.
              </p>
            )}

            <button className="sk-btn self-start" data-variant="primary"
                    disabled={generate.isPending || p.toBill === 0}
                    onClick={() => generate.mutate()}>
              {generate.isPending
                ? 'Issuing…'
                : p.toBill === 0
                  ? 'Nothing left to bill'
                  : `Issue ${p.toBill} bills · ${rupees(p.totalMinor)}`}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
