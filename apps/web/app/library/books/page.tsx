'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, EmptyRow, SectionH, type TitleView } from './../ui';

function useDebounced(value: string, ms = 250): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Ticket {
  title: string;
  author: string;
  shelf: string | null;
  accessionNo: string;
  nth: number;
}

export default function LibraryBooksPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [form, setForm] = useState<{ title: string; author: string; shelf: string } | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const hits = useQuery({
    queryKey: ['library-titles', host, dq, 'add'],
    enabled: !!host && dq.trim().length >= 2,
    queryFn: () => api.get<TitleView[]>(`/library/titles?q=${encodeURIComponent(dq.trim())}`),
  });

  function ticketFrom(t: TitleView): Ticket {
    // The just-created copy is the school's newest number.
    const newest = [...t.copies].sort((a, b) => (a.accessionNo < b.accessionNo ? 1 : -1))[0];
    return { title: t.title, author: t.author, shelf: t.shelf, accessionNo: newest.accessionNo, nth: t.totalCopies };
  }

  const addCopy = useMutation({
    mutationFn: (titleId: string) => api.post<TitleView>(`/library/titles/${titleId}/copies`, {}),
    onSuccess: (t) => {
      const tk = ticketFrom(t);
      setTicket(tk);
      setForm(null);
      qc.invalidateQueries({ queryKey: ['library-titles'] });
      qc.invalidateQueries({ queryKey: ['library-dashboard'] });
      toast.success(`Copy added — ${tk.accessionNo}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const createTitle = useMutation({
    mutationFn: (body: { title: string; author: string; shelf?: string }) =>
      api.post<TitleView>('/library/titles', body),
    onSuccess: (t) => {
      const tk = ticketFrom(t);
      setTicket(tk);
      setForm(null);
      setFormErr(null);
      setQ('');
      qc.invalidateQueries({ queryKey: ['library-titles'] });
      qc.invalidateQueries({ queryKey: ['library-dashboard'] });
      toast.success(`“${t.title}” added — ${tk.accessionNo}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const exactDupe = form
    ? hits.data?.find((t) => t.title.trim().toLowerCase() === form.title.trim().toLowerCase())
    : undefined;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h1 className="font-serif text-xl font-semibold" style={{ fontFamily: 'var(--sk-serif)' }}>
          New books
        </h1>
        <span className="text-xs text-[var(--sk-ink-3)]">every copy gets its own number</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <SectionH>Type a title — it checks the shelf first</SectionH>
          <div className="flex items-center gap-2 rounded-lg border-2 border-[var(--sk-line-2)] bg-[var(--sk-card)] px-3 py-2 shadow-sm focus-within:border-[var(--sk-brand)]">
            <span aria-hidden="true">➕</span>
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setForm(null); }}
              placeholder="Start typing a title…"
              aria-label="New book title"
              className="w-full bg-transparent text-sm text-[var(--sk-ink)] outline-none placeholder:text-[var(--sk-ink-3)]"
            />
          </div>

          {dq.trim().length >= 2 && hits.data && !form ? (
            <Card className="mt-2 overflow-hidden">
              {hits.data.map((t) => (
                <div key={t.id} className="flex items-center gap-2 border-b border-[var(--sk-line)] px-3 py-2 text-sm last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold" style={{ fontFamily: 'var(--sk-serif)' }}>{t.title}</span>
                    <span className="block text-xs text-[var(--sk-ink-3)]">
                      {t.author} · {t.totalCopies} {t.totalCopies === 1 ? 'copy' : 'copies'} · shelf {t.shelf ?? '—'}
                    </span>
                  </span>
                  <button
                    className="whitespace-nowrap rounded-full bg-[var(--sk-brand-tint)] px-3 py-1 text-[11px] font-bold text-[var(--sk-brand-2)]"
                    onClick={() => addCopy.mutate(t.id)}
                    disabled={addCopy.isPending}
                  >
                    + Add a copy
                  </button>
                </div>
              ))}
              <button
                className="flex w-full items-center gap-2 bg-[var(--sk-brand-tint)] px-3 py-2 text-left text-sm hover:brightness-105"
                onClick={() => { setForm({ title: q.trim(), author: '', shelf: 'C-2' }); setTicket(null); }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[var(--sk-brand-2)]">Add “{dq.trim()}” as a new title</span>
                  <span className="block text-xs text-[var(--sk-ink-3)]">name · author · shelf</span>
                </span>
                <span className="text-[11px] font-bold text-[var(--sk-brand-2)]">Create →</span>
              </button>
            </Card>
          ) : null}

          {form ? (
            <Card className="mt-2 flex flex-col gap-2 p-3">
              {exactDupe ? (
                <div className="rounded-lg border border-[var(--sk-amber)] bg-[var(--sk-amber-tint)] px-3 py-2 text-xs text-[var(--sk-amber-ink)]">
                  ⚠️ “{exactDupe.title}” already exists ({exactDupe.totalCopies}{' '}
                  {exactDupe.totalCopies === 1 ? 'copy' : 'copies'}). Add a copy instead — unless this is truly a
                  different book.
                </div>
              ) : null}
              {(
                [
                  ['title', 'Title'],
                  ['author', 'Author'],
                  ['shelf', 'Shelf'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-xs">
                  <span className="mb-0.5 block font-bold uppercase tracking-wide text-[var(--sk-ink-3)]">{label}</span>
                  <input
                    value={form[key]}
                    onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
                    className="w-full rounded-lg border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-2.5 py-1.5 text-sm text-[var(--sk-ink)]"
                  />
                </label>
              ))}
              {formErr ? <p className="text-xs text-[var(--sk-bad)]">{formErr}</p> : null}
              <button
                className="rounded-lg bg-[var(--sk-brand)] py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={createTitle.isPending}
                onClick={() => {
                  if (!form.title.trim() || !form.author.trim()) {
                    setFormErr('Title and author are both needed.');
                    return;
                  }
                  createTitle.mutate({ title: form.title, author: form.author, shelf: form.shelf || undefined });
                }}
              >
                Add book
              </button>
            </Card>
          ) : null}
        </div>

        <div>
          <SectionH>The new copy&rsquo;s ticket</SectionH>
          {ticket ? (
            <Card className="relative overflow-hidden p-4" data-testid="accession-ticket">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1.5"
                style={{
                  background:
                    'repeating-linear-gradient(90deg, var(--sk-amber) 0 14px, var(--sk-brand) 14px 28px, var(--sk-good) 28px 42px, var(--sk-bad) 42px 56px)',
                }}
              />
              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--sk-ink-3)]">New copy added</p>
              <dl className="mt-2 text-sm">
                {(
                  [
                    ['Title', ticket.title],
                    ['Author', ticket.author],
                    ['Copy', `${ticket.nth}${['th', 'st', 'nd', 'rd'][ticket.nth % 100 > 10 && ticket.nth % 100 < 14 ? 0 : ticket.nth % 10 < 4 ? ticket.nth % 10 : 0]} copy · shelf ${ticket.shelf ?? '—'}`],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[80px,1fr] gap-2 border-b border-dashed border-[var(--sk-line)] py-1">
                    <dt className="text-[var(--sk-ink-3)]">{k}</dt>
                    <dd className="font-semibold text-[var(--sk-ink)]">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 rounded-lg border-2 border-dashed border-[var(--sk-amber)] bg-[var(--sk-amber-tint)] py-2 text-center">
                <div className="font-mono text-lg font-extrabold tracking-[0.12em] text-[var(--sk-amber-ink)]">
                  {ticket.accessionNo}
                </div>
                <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--sk-amber-ink)]">
                  Book number — printed on the sticker
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyRow>
                The new copy&rsquo;s ticket appears here with its book number. A lost book is a known book — the
                number says exactly which copy.
              </EmptyRow>
            </Card>
          )}
          {hits.data && dq.trim().length >= 2 && !hits.data.length && !form ? (
            <p className="mt-2 text-xs text-[var(--sk-ink-3)]">
              Nothing on the shelf matches — use “Add as a new title” on the left.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
