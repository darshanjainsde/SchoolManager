'use client';
// apps/web/app/app/enquiries/page.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { saveBlob } from '@/lib/save-blob';
import { LeadPanel } from './lead-panel';
import { AddEnquiryDrawer } from './add-enquiry';
import {
  STAGE_LABEL, avatarVar, deskCounts, deskOrder, dueLabel, initials, leadsCsv,
  matchesFilter, matchesQuery, sourceLabel, stageTone,
  type DeskFilter, type Lead,
} from './lead';

interface Me {
  userId?: string;
  role?: string;
  staffRole?: string | null;
}

/** More than this on screen is a wall; the rest is one tap away. */
const PAGE = 200;

const CHIPS: { key: DeskFilter; label: string }[] = [
  { key: 'MINE', label: 'My leads' },
  { key: 'UNOWNED', label: 'Unowned' },
  { key: 'OPEN', label: 'Open' },
  { key: 'ALL', label: 'All' },
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'INTERESTED', label: 'Interested' },
  { key: 'VISITED', label: 'Visited' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'ENROLLED', label: 'Enrolled' },
  { key: 'LOST', label: 'Lost' },
];

/** What an empty filter means, where "Nothing matches" would say too little. */
const EMPTY: Partial<Record<DeskFilter, string>> = {
  MINE: 'No leads are yours yet — take one from Unowned.',
  UNOWNED: 'Every open lead has somebody on it.',
};

/**
 * The admissions desk.
 *
 * The summary tiles answer the question the desk asks every morning — who do
 * I ring today — and each one filters the list. The list sorts by urgency,
 * because the bottom of a date-ordered list is where a forgotten family stays
 * forgotten. An admissions officer opens on their own leads; an admin on every
 * open one.
 */
export default function EnquiriesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const [picked, setPicked] = useState<DeskFilter | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  // A lead just added at the desk: it must be the one opened, and the list has
  // not refetched yet, so the selection effect must not replace it.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const savedAt = useRef(0);

  const me = useQuery({
    queryKey: ['me', host],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: !!host,
    staleTime: 5 * 60_000,
  });
  const meId = me.data?.userId ?? null;
  const officer = me.data?.role === 'STAFF' && me.data?.staffRole === 'ADMISSIONS';
  const home: DeskFilter = officer ? 'MINE' : 'OPEN';
  const filter: DeskFilter = picked ?? home;

  const leads = useQuery({
    queryKey: ['site-enquiries', host],
    queryFn: () => api.get<Lead[]>('/site/enquiries'),
    enabled: !!host,
    staleTime: 30_000,
  });

  // Until /auth/me answers nobody knows whose desk this is. Showing the admin
  // view meanwhile would put a stranger's lead on an officer's screen (and fetch it).
  const meLoading = me.isLoading;

  const rows = useMemo(() => {
    if (meLoading) return [];
    const all = leads.data ?? [];
    return deskOrder(all.filter((l) => matchesFilter(l, filter, undefined, meId) && matchesQuery(l, query)));
  }, [leads.data, filter, query, meId, meLoading]);

  // The chip counts walk every lead once per chip — not on every keystroke.
  const chipCounts = useMemo(() => {
    const all = leads.data ?? [];
    return Object.fromEntries(CHIPS.map((c) => [c.key, all.filter((l) => matchesFilter(l, c.key, undefined, meId)).length])) as Record<string, number>;
  }, [leads.data, meId]);

  // The lead being worked on is always on screen, however far down it sits.
  const selectedAt = selected ? rows.findIndex((r) => r.id === selected) : -1;
  const shown = rows.slice(0, Math.max(limit, selectedAt + 1));

  const counts = useMemo(() => deskCounts(leads.data ?? []), [leads.data]);

  // Keep a lead selected as the list changes, but never one that has been
  // filtered away — a detail panel showing a family you cannot see in the list
  // is how you edit the wrong record.
  useEffect(() => {
    if (pendingId) {
      if (rows.some((r) => r.id === pendingId)) setPendingId(null);
      else if (leads.isError) setPendingId(null);
      else if (leads.isFetching || leads.dataUpdatedAt < savedAt.current) return;
      else setPendingId(null);
    }
    if (rows.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !rows.some((r) => r.id === selected)) setSelected(rows[0].id);
  }, [rows, selected, pendingId, leads.isFetching, leads.isError, leads.dataUpdatedAt]);

  function exportCsv() {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    // A leading byte-order mark is what makes Excel read Devanagari names as UTF-8.
    saveBlob(new Blob(['\uFEFF' + leadsCsv(rows)], { type: 'text/csv;charset=utf-8' }), `enquiries-${filter.toLowerCase()}-${day}.csv`);
  }

  const tiles: { key: DeskFilter; lab: string; n: number; tone?: string; hint: string }[] = [
    { key: 'OVERDUE', lab: 'Overdue', n: counts.overdue, tone: 'bad', hint: 'past their callback' },
    { key: 'TODAY', lab: 'Due today', n: counts.today, tone: 'warn', hint: 'ring these first' },
    { key: 'NEW', lab: 'Never contacted', n: counts.never, hint: 'nobody has called yet' },
    { key: 'NODUE', lab: 'No next step', n: counts.nodue, hint: 'open, with no callback set' },
    { key: 'ENROLLED', lab: 'Enrolled', n: counts.enrolled, tone: 'good', hint: `of ${(leads.data ?? []).length} enquiries` },
  ];

  return (
    <div className="skosx">
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Enquiries</h1>
          <p>Every family who asked about a place — and what happens next for each of them.</p>
        </div>
        <div className="sk-wrap-sm" style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="sk-btn sk-press" disabled={rows.length === 0} onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setAdding(true)}>
            Add enquiry
          </button>
        </div>
      </header>

      <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            className="sk-kpi"
            data-tone={t.tone}
            aria-pressed={filter === t.key}
            onClick={() => { setPicked(filter === t.key ? home : t.key); setLimit(PAGE); }}
          >
            <span className="lab">{t.lab}</span>
            <span className="n">{t.n}</span>
            <span className="hint">{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="sk-enq-desk" style={{ marginTop: 16 }}>
        <div className="sk-card">
          <div className="sk-card-b" style={{ gap: 12 }}>
            <input
              className="sk-input"
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
              placeholder="Search a name or a phone number…"
              aria-label="Search leads"
            />

            <div className="sk-enq-filters" role="group" aria-label="Filter leads">
              {CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="sk-enq-chip"
                  aria-pressed={filter === c.key}
                  onClick={() => { setPicked(c.key); setLimit(PAGE); }}
                >
                  {c.label} {chipCounts[c.key]}
                </button>
              ))}
            </div>

            {leads.isLoading || meLoading ? <p className="sk-state">Reading the enquiries…</p> : null}
            {leads.error ? <p className="sk-state err">{(leads.error as Error).message}</p> : null}

            {!leads.isLoading && !meLoading && !leads.error && rows.length === 0 ? (
              <p className="sk-state">
                {(leads.data ?? []).length === 0
                  ? 'No enquiries yet — they appear here the moment somebody submits the form on your website, or you add one.'
                  : (EMPTY[filter] ?? 'Nothing matches.')}
              </p>
            ) : null}

            {rows.length > 0 ? (
              <div className="sk-enq-list" role="listbox" aria-label="Leads">
                {shown.map((l) => {
                  const due = dueLabel(l);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="option"
                      className="sk-enq-row"
                      aria-selected={selected === l.id}
                      aria-current={selected === l.id}
                      onClick={() => setSelected(l.id)}
                    >
                      <span className="av" style={{ background: `var(${avatarVar(l.parentName)})` }}>
                        {initials(l.parentName)}
                      </span>
                      <span className="txt">
                        <span className="nm">{l.parentName}</span>
                        <span className="meta">
                          {l.gradeInterest ?? 'No class given'}
                          {l.ownerName ? ` · ${l.ownerName}` : ''}
                        </span>
                      </span>
                      <span className="side">
                        <span className="sk-pill" data-tone={stageTone(l.status)}>{STAGE_LABEL[l.status]}</span>
                        <span className="sk-enq-src">{sourceLabel(l)}</span>
                        {due ? <span className="sk-enq-due" data-tone={due.tone}>{due.text}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {shown.length < rows.length ? (
              <button type="button" className="sk-btn" onClick={() => setLimit(shown.length + PAGE)}>
                Show {rows.length - shown.length} more
              </button>
            ) : null}
          </div>
        </div>

        <div>{selected ? <LeadPanel key={selected} id={selected} /> : <p className="sk-state">Pick a family on the left.</p>}</div>
      </div>

      {adding ? <AddEnquiryDrawer onClose={() => setAdding(false)} onSaved={(id) => {
        // Open the new lead, and make it visible: back to the home filter, no search.
        savedAt.current = Date.now();
        setPendingId(id);
        setSelected(id);
        setPicked(null);
        setQuery('');
        setLimit(PAGE);
      }} /> : null}
    </div>
  );
}
