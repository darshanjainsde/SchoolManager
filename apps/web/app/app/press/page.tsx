'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUpRight, BookMarked, CalendarRange, Package, Printer, ScrollText } from 'lucide-react';
import type { ReportWindowRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { pressDateLabel } from '@/lib/press';

/**
 * The Press home.
 *
 * The office's mental model is "print Term I for VII-B", so the page is one
 * decision (which window) followed by one grid (which class). Certificates and
 * the register are separate desks and get their own cards, not tabs — a nav
 * row here would centre itself and shrink (`.sk-tabs` is the page NAV, not a
 * chip row).
 */

type YearRow = { id: string; name: string; isCurrent: boolean; startDate: string };
type ClassRow = { id: string; label: string; studentCount: number };

/** A fresh school gets a prefilled first window: current year start → today. */
function draftFrom(years: YearRow[]): { academicYearId: string; name: string; startDate: string; endDate: string } {
  const current = years.find((y) => y.isCurrent) ?? years[0];
  return {
    academicYearId: current?.id ?? '',
    name: 'Term I',
    startDate: current?.startDate ?? '',
    endDate: new Date().toISOString().slice(0, 10),
  };
}

export default function PressHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const windows = useQuery({
    queryKey: ['press-windows', host], enabled: !!host,
    queryFn: () => api.get<ReportWindowRow[]>('/manage/press/windows'),
  });
  const years = useQuery({
    queryKey: ['press-years', host], enabled: !!host,
    queryFn: () => api.get<YearRow[]>('/manage/press/years'),
  });
  const classes = useQuery({
    queryKey: ['press-classes', host], enabled: !!host,
    queryFn: () => api.get<ClassRow[]>('/manage/press/classes'),
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof draftFrom> | null>(null);

  const saveWindow = useMutation({
    mutationFn: (body: NonNullable<typeof draft>) => api.put<ReportWindowRow>('/manage/press/windows', body),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['press-windows', host] });
      setDraft(null);
      setSelected(w.id);
      toast.success(`${w.name} is ready. Pick a class below.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the window.'),
  });

  const windowRows = windows.data ?? [];
  const active = windowRows.find((w) => w.id === selected) ?? windowRows[0] ?? null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="sk-pagehead">
        <h1>The Press</h1>
        <p>Report cards, certificates and the register they are recorded in.</p>
      </header>

      {(windows.isLoading || classes.isLoading) && <p className="sk-state">Opening the Press…</p>}
      {windows.isError && <p className="sk-state err">The Press could not load. Refresh to try again.</p>}

      {windows.data && (
        <>
          {/* ── Step 1 · the reporting window ───────────────────────────── */}
          <div className="sk-card">
            <div className="sk-card-b">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CalendarRange size={16} style={{ color: 'var(--sk-brand-2)' }} aria-hidden="true" />
                  <b>Reporting window</b>
                </div>
                {!draft && (
                  <button className="sk-btn" onClick={() => setDraft(draftFrom(years.data ?? []))}>
                    New window
                  </button>
                )}
              </div>

              {windowRows.length === 0 && !draft && (
                <p className="sk-state">
                  A window is the stretch of the year one report card covers — &ldquo;Term I&rdquo;, &ldquo;Half-Yearly&rdquo;.
                  Create the first one and every class below compiles from the marks teachers have already entered.
                </p>
              )}

              {windowRows.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {windowRows.map((w) => (
                    <button
                      key={w.id}
                      className="sk-btn"
                      aria-pressed={active?.id === w.id}
                      onClick={() => setSelected(w.id)}
                    >
                      {w.name} · {w.academicYearName}
                      <span style={{ color: 'var(--sk-ink-3)', fontWeight: 500 }}>
                        {pressDateLabel(w.startDate)} – {pressDateLabel(w.endDate)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {draft && (
                <form
                  onSubmit={(e) => { e.preventDefault(); saveWindow.mutate(draft); }}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}
                >
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                    Name
                    <input
                      className="sk-input" required maxLength={40} value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="Term I"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                    Academic year
                    <select
                      className="sk-input" required value={draft.academicYearId}
                      onChange={(e) => setDraft({ ...draft, academicYearId: e.target.value })}
                    >
                      {(years.data ?? []).map((y) => (
                        <option key={y.id} value={y.id}>{y.name}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                    From
                    <input
                      type="date" className="sk-input" required value={draft.startDate}
                      onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                    To
                    <input
                      type="date" className="sk-input" required value={draft.endDate}
                      onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="sk-btn" data-variant="primary" disabled={saveWindow.isPending}>
                      {saveWindow.isPending ? 'Saving…' : 'Save window'}
                    </button>
                    <button type="button" className="sk-btn" onClick={() => setDraft(null)}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* ── Step 2 · pick a class ───────────────────────────────────── */}
          {active && (
            <div className="sk-cardgrid">
              {(classes.data ?? []).map((c) => (
                <Link key={c.id} href={`/app/press/batch/${active.id}/${c.id}`} className="sk-entity sk-press">
                  <span className="av" style={{ background: 'var(--sk-brand)' }}>
                    <Printer size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="nm">{c.label}</div>
                    <div className="meta">{c.studentCount} students · {active.name}</div>
                  </div>
                  <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
                </Link>
              ))}
              {classes.data?.length === 0 && (
                <p className="sk-state">No classes yet — set up classes and students first, then come back to print.</p>
              )}
            </div>
          )}

          {/* ── The other two desks ─────────────────────────────────────── */}
          <div className="sk-cardgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <Link href="/app/press/certificates" className="sk-entity sk-press">
              <span className="av" style={{ background: 'var(--sk-amber)' }}>
                <ScrollText size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="nm">Certificates</div>
                <div className="meta">TC, bonafide, character — serial-numbered</div>
              </div>
              <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
            </Link>
            <Link href="/app/press/register" className="sk-entity sk-press">
              <span className="av" style={{ background: 'var(--sk-ink-2)' }}>
                <BookMarked size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="nm">The register</div>
                <div className="meta">Every document ever issued · reprints</div>
              </div>
              <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
            </Link>
            <Link href="/app/press/orders" className="sk-entity sk-press">
              <span className="av" style={{ background: 'var(--sk-good)' }}>
                <Package size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="nm">Print orders</div>
                <div className="meta">Sckools prints &amp; delivers · quote first</div>
              </div>
              <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
