'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUpRight, BookMarked, FileUp, Package, ScrollText, Search } from 'lucide-react';
import type { PressOverview, PressIssueRow, ReportWindowRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { rupees } from '@/lib/fees';
import { PRESS_TYPE_LABEL, pressDateLabel } from '@/lib/press';

/**
 * The Press home — a counter, not a catalogue.
 *
 * Most Press visits are about ONE child (a certificate, a reprint); a few
 * times a term they're about one class (the batch); occasionally about paper
 * itself (an order to Sckools). The page is those three things in that order:
 *
 *   Zone 1 · the counter — one search, straight to the child or the serial.
 *   Zone 2 · the scoreboard — this term's cards as a progress list, pending
 *            first, so October's "are Term I cards done?" has an answer.
 *   Zone 3 · the drawers — certificates, register, orders, each with a LIVE
 *            fact (nothing static — house rule).
 *
 * One read (`GET /manage/press/overview`) feeds zones 2 and 3; the counter
 * reuses the Press's own student search plus the register's serial search.
 */

type StudentHit = { id: string; name: string; admissionNo: string; classLabel: string | null; isActive: boolean };
type YearRow = { id: string; name: string; isCurrent: boolean; startDate: string };

/** A fresh school gets a prefilled first window: current year start → today. */
function draftFrom(years: YearRow[]): { academicYearId: string; name: string; startDate: string; endDate: string } {
  const current = years.find((y) => y.isCurrent) ?? years[0];
  return {
    academicYearId: current?.id ?? '',
    name: 'Term I',
    startDate: current?.startDate?.slice(0, 10) ?? '',
    endDate: new Date().toISOString().slice(0, 10),
  };
}

const zlab: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
  color: 'var(--sk-ink-3)', display: 'flex', alignItems: 'center', gap: 10,
};

function ZoneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={zlab}>
      <span style={{ flex: 'none' }}>{children}</span>
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: 'var(--sk-line)' }} />
    </div>
  );
}

export default function PressHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  // ── zone 2 state ──────────────────────────────────────────────────────────
  const [windowId, setWindowId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof draftFrom> | null>(null);

  const overview = useQuery({
    queryKey: ['press-overview', host, windowId], enabled: !!host,
    queryFn: () => api.get<PressOverview>(`/manage/press/overview${windowId ? `?windowId=${windowId}` : ''}`),
  });
  const years = useQuery({
    queryKey: ['press-years', host], enabled: !!host && !!draft,
    queryFn: () => api.get<YearRow[]>('/manage/press/years'),
  });

  const saveWindow = useMutation({
    mutationFn: (body: NonNullable<typeof draft>) => api.put<ReportWindowRow>('/manage/press/windows', body),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['press-overview', host] });
      setDraft(null);
      setWindowId(w.id);
      toast.success(`${w.name} is ready — the scoreboard below now counts it.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the window.'),
  });

  // ── zone 1: the counter ───────────────────────────────────────────────────
  const [q, setQ] = useState('');
  const query = q.trim();
  const students = useQuery({
    queryKey: ['press-student-search', host, query], enabled: !!host && query.length >= 2,
    queryFn: () => api.get<StudentHit[]>(`/manage/press/students?q=${encodeURIComponent(query)}`),
  });
  const serials = useQuery({
    queryKey: ['press-serial-search', host, query], enabled: !!host && query.length >= 3,
    queryFn: () => api.get<{ items: PressIssueRow[] }>(`/manage/press/register?q=${encodeURIComponent(query)}`),
  });

  const o = overview.data;
  const active = o?.windows.find((w) => w.id === o.windowId) ?? null;
  const countable = (o?.classes ?? []).filter((c) => c.students > 0);
  const pending = countable.filter((c) => c.issued < c.students);
  const rows = showAll ? (o?.classes ?? []) : pending;
  const termIssued = countable.reduce((n, c) => n + Math.min(c.issued, c.students), 0);
  const termTotal = countable.reduce((n, c) => n + c.students, 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="sk-pagehead">
        <h1>The Press</h1>
        <p>Everything the school puts on paper — cards, certificates, the register, and the printing itself.</p>
      </header>

      {/* ── zone 1 · the counter ─────────────────────────────────────────── */}
      <div className="sk-card">
        <div className="sk-card-b">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={15} style={{ color: 'var(--sk-ink-3)', flex: 'none' }} aria-hidden="true" />
            <input
              className="sk-input" style={{ flex: 1 }} autoComplete="off"
              placeholder="Type a child's name, admission no., or a serial — certificates and reprints start here"
              value={q} onChange={(e) => setQ(e.target.value)}
            />
          </label>

          {query.length >= 2 && (students.data?.length || serials.data?.items.length) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(students.data ?? []).slice(0, 4).map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 180 }}>
                    <b style={{ fontSize: 13.5 }}>{h.name}</b>
                    <span className="sk-muted" style={{ fontSize: 12 }}>
                      {' '}· {h.classLabel ?? 'no class'} · Adm {h.admissionNo}{h.isActive ? '' : ' · left'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Link className="sk-btn" data-variant="primary" style={{ padding: '5px 10px', fontSize: 12 }}
                      href={`/app/press/certificates?q=${encodeURIComponent(h.admissionNo)}`}>
                      New certificate
                    </Link>
                    <Link className="sk-btn" style={{ padding: '5px 10px', fontSize: 12 }}
                      href={`/app/press/register?q=${encodeURIComponent(h.admissionNo)}`}>
                      Their documents
                    </Link>
                    <Link className="sk-btn" style={{ padding: '5px 10px', fontSize: 12 }} href={`/app/students/${h.id}`}>
                      Student 360
                    </Link>
                  </div>
                </div>
              ))}
              {(serials.data?.items ?? []).slice(0, 3).map((it) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 180 }}>
                    <b className="sk-num" style={{ fontSize: 13 }}>{it.serial}</b>
                    <span className="sk-muted" style={{ fontSize: 12 }}>
                      {' '}· {PRESS_TYPE_LABEL[it.type]} · {it.studentName} · {pressDateLabel(it.issuedAt)}
                      {it.voidedAt ? ' · VOID' : ''}
                    </span>
                  </div>
                  <Link className="sk-btn" style={{ padding: '5px 10px', fontSize: 12 }}
                    href={`/app/press/register?q=${encodeURIComponent(it.serial)}`}>
                    Open in the register
                  </Link>
                </div>
              ))}
            </div>
          ) : null}
          {query.length >= 2 && students.data && students.data.length === 0 && (serials.data?.items.length ?? 0) === 0 && (
            <p className="sk-state">Nobody and no serial matches — try a shorter part of the name.</p>
          )}
        </div>
      </div>

      {/* ── zone 2 · the scoreboard ──────────────────────────────────────── */}
      <ZoneLabel>This term&rsquo;s report cards</ZoneLabel>

      {overview.isLoading && <p className="sk-state">Opening the Press…</p>}
      {overview.isError && <p className="sk-state err">The Press could not load. Refresh to try again.</p>}

      {o && o.windows.length === 0 && !draft && (
        <div className="sk-card"><div className="sk-card-b">
          <p className="sk-state">
            A window is the stretch of the year one report card covers — &ldquo;Term I&rdquo;, &ldquo;Half-Yearly&rdquo;.
            Create the first one and every class compiles from the marks teachers have already entered.
          </p>
          <button className="sk-btn" data-variant="primary" style={{ alignSelf: 'flex-start' }}
            onClick={() => setDraft(draftFrom([]))}>
            New window
          </button>
        </div></div>
      )}

      {o && o.windows.length > 0 && (
        <div className="sk-card"><div className="sk-card-b">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <select
              className="sk-input" style={{ width: 'auto', fontWeight: 650 }}
              value={o.windowId ?? ''}
              onChange={(e) => {
                if (e.target.value === '__new') { setDraft(draftFrom([])); return; }
                setWindowId(e.target.value);
              }}
            >
              {o.windows.map((w) => (
                <option key={w.id} value={w.id}>{w.name} · {w.academicYearName}</option>
              ))}
              <option value="__new">＋ New window…</option>
            </select>
            {termTotal > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--sk-ink-2)' }}>
                <span><b style={{ color: 'var(--sk-ink)' }}>{termIssued} of {termTotal}</b> cards issued</span>
                <span aria-hidden="true" style={{ width: 140, height: 8, borderRadius: 99, background: 'var(--sk-bg-2)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.round((termIssued / termTotal) * 100)}%`, background: 'var(--sk-brand)', borderRadius: 99 }} />
                </span>
              </div>
            )}
          </div>

          {draft && (
            <form
              onSubmit={(e) => { e.preventDefault(); saveWindow.mutate(draft); }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                Name
                <input className="sk-input" required maxLength={40} value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Term I" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                Academic year
                <select className="sk-input" required value={draft.academicYearId}
                  onChange={(e) => setDraft({ ...draft, academicYearId: e.target.value })}>
                  <option value="">Pick…</option>
                  {(years.data ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                From
                <input type="date" className="sk-input" required value={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                To
                <input type="date" className="sk-input" required value={draft.endDate}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="sk-btn" data-variant="primary" disabled={saveWindow.isPending}>
                  {saveWindow.isPending ? 'Saving…' : 'Save window'}
                </button>
                <button type="button" className="sk-btn" onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </form>
          )}

          {active && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="sk-btn" aria-pressed={!showAll} style={{ padding: '5px 12px', fontSize: 12 }}
                  onClick={() => setShowAll(false)}>
                  Needs work · {pending.length}
                </button>
                <button className="sk-btn" aria-pressed={showAll} style={{ padding: '5px 12px', fontSize: 12 }}
                  onClick={() => setShowAll(true)}>
                  All {o.classes.length} classes
                </button>
              </div>

              {rows.length === 0 && !showAll && countable.length > 0 && (
                <p className="sk-state" style={{ margin: 0 }}>
                  Every class&rsquo;s cards are in the register for {active.name}. Switch to &ldquo;All classes&rdquo; to
                  reprint or send a batch to print.
                </p>
              )}
              {countable.length === 0 && (
                <p className="sk-state" style={{ margin: 0 }}>No classes with active students yet — set up classes and students first.</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {rows.map((c) => {
                  const done = c.students > 0 && c.issued >= c.students;
                  const pct = c.students > 0 ? Math.round((Math.min(c.issued, c.students) / c.students) * 100) : 0;
                  return (
                    <Link key={c.id} href={`/app/press/batch/${active.id}/${c.id}`}
                      className="sk-press"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, padding: '9px 12px',
                        border: '1px solid var(--sk-line)', borderRadius: 10, fontSize: 13,
                        opacity: done ? 0.75 : 1, color: 'inherit', textDecoration: 'none',
                      }}>
                      <b style={{ width: 92, flex: 'none' }}>{c.label}</b>
                      <span aria-hidden="true" style={{ flex: 1, height: 7, borderRadius: 99, background: 'var(--sk-bg-2)', overflow: 'hidden', minWidth: 60 }}>
                        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: done ? 'var(--sk-good)' : 'var(--sk-brand)', borderRadius: 99 }} />
                      </span>
                      <span className="sk-num sk-muted" style={{ width: 84, textAlign: 'right', flex: 'none', fontSize: 12 }}>
                        {c.students === 0 ? 'no students' : `${c.issued} / ${c.students}${done ? ' ✓' : ''}`}
                      </span>
                      <span style={{ color: done ? 'var(--sk-good)' : 'var(--sk-brand-2)', fontWeight: 700, fontSize: 12, flex: 'none' }}>
                        {done ? 'Reprint · order' : c.issued > 0 ? 'Continue →' : 'Compile →'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div></div>
      )}

      {/* ── zone 3 · the drawers ─────────────────────────────────────────── */}
      <ZoneLabel>The drawers</ZoneLabel>
      <div className="sk-cardgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <Link href="/app/press/certificates" className="sk-entity sk-press">
          <span className="av" style={{ background: 'var(--sk-amber)' }}><ScrollText size={20} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="nm">Certificates</div>
            <div className="meta">
              {o?.certificates.lastSerial
                ? `last ${o.certificates.lastSerial} · ${o.certificates.thisYear} this year`
                : 'TC (Annexure-I), bonafide, character'}
            </div>
          </div>
          <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
        </Link>
        <Link href="/app/press/register" className="sk-entity sk-press">
          <span className="av" style={{ background: 'var(--sk-ink-2)' }}><BookMarked size={20} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="nm">The register</div>
            <div className="meta">{o ? `${o.register.total} documents · reprint any` : 'every document ever issued'}</div>
          </div>
          <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
        </Link>
        <Link href="/app/press/orders" className="sk-entity sk-press">
          <span className="av" style={{ background: 'var(--sk-good)' }}><Package size={20} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="nm">
              Print orders
              {(o?.orders.awaitingConfirm ?? 0) > 0 && (
                <span className="sk-pill" data-tone="warn" style={{ marginLeft: 8 }}>
                  {o!.orders.awaitingConfirm} quote{o!.orders.awaitingConfirm === 1 ? '' : 's'} waiting
                </span>
              )}
            </div>
            <div className="meta">
              {(o?.orders.awaitingConfirm ?? 0) > 0
                ? `${rupees(o!.orders.quotedTotalMinor)} quoted — confirm to print`
                : o && o.orders.open > 0
                  ? `${o.orders.open} order${o.orders.open === 1 ? '' : 's'} in motion`
                  : 'Sckools prints & delivers · quote first'}
            </div>
          </div>
          <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
        </Link>
        <Link href="/app/press/orders" className="sk-entity sk-press">
          <span className="av" style={{ background: 'var(--sk-brand)' }}><FileUp size={20} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="nm">Send a PDF to print</div>
            <div className="meta">exam papers, circulars — kept confidential</div>
          </div>
          <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
