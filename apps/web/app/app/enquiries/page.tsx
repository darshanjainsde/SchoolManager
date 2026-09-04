'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { LeadPanel } from './lead-panel';
import {
  STAGE_LABEL, avatarVar, deskCounts, deskOrder, dueLabel, initials,
  matchesFilter, matchesQuery, stageTone,
  type DeskFilter, type Lead,
} from './lead';

const CHIPS: { key: DeskFilter; label: string }[] = [
  { key: 'OPEN', label: 'Open' },
  { key: 'ALL', label: 'All' },
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'VISITED', label: 'Visited' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'ENROLLED', label: 'Enrolled' },
  { key: 'LOST', label: 'Lost' },
];

/**
 * The admissions desk.
 *
 * This was a stack of full-width rows with two buttons each, on the shadcn kit,
 * with the right half of the console empty. The rebuild is not mainly about the
 * skin: an enquiry had no note, no owner and no follow-up date, so "Mark
 * contacted" was a claim nobody could check and nothing on the page answered
 * the question the desk asks every morning — who do I ring today.
 *
 * The summary tiles ARE that answer, and each one filters the list. The list
 * sorts by urgency rather than by date received, because the bottom of a
 * date-ordered list is where a forgotten family stays forgotten.
 */
export default function EnquiriesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const [filter, setFilter] = useState<DeskFilter>('OPEN');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const leads = useQuery({
    queryKey: ['site-enquiries', host],
    queryFn: () => api.get<Lead[]>('/site/enquiries'),
    enabled: !!host,
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const all = leads.data ?? [];
    return deskOrder(all.filter((l) => matchesFilter(l, filter) && matchesQuery(l, query)));
  }, [leads.data, filter, query]);

  const counts = useMemo(() => deskCounts(leads.data ?? []), [leads.data]);

  // Keep a lead selected as the list changes, but never one that has been
  // filtered away — a detail panel showing a family you cannot see in the list
  // is how you edit the wrong record.
  useEffect(() => {
    if (rows.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !rows.some((r) => r.id === selected)) setSelected(rows[0].id);
  }, [rows, selected]);

  const tiles: { key: DeskFilter; lab: string; n: number; tone?: string; hint: string }[] = [
    { key: 'OVERDUE', lab: 'Overdue', n: counts.overdue, tone: 'bad', hint: 'past their callback' },
    { key: 'TODAY', lab: 'Due today', n: counts.today, tone: 'warn', hint: 'ring these first' },
    { key: 'NEW', lab: 'Never contacted', n: counts.never, hint: 'nobody has called yet' },
    { key: 'NODUE', lab: 'No next step', n: counts.nodue, hint: 'open, with no callback set' },
    { key: 'ENROLLED', lab: 'Enrolled', n: counts.enrolled, tone: 'good', hint: `of ${(leads.data ?? []).length} enquiries` },
  ];

  return (
    <div className="skosx">
      <header className="sk-pagehead flex items-start justify-between gap-3">
        <div>
          <h1>Enquiries</h1>
          <p>Every family who asked about a place — and what happens next for each of them.</p>
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
            onClick={() => setFilter(filter === t.key ? 'OPEN' : t.key)}
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
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a name or a phone number…"
              aria-label="Search leads"
            />

            <div className="sk-enq-filters" role="group" aria-label="Filter by stage">
              {CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="sk-enq-chip"
                  aria-pressed={filter === c.key}
                  onClick={() => setFilter(c.key)}
                >
                  {c.label} {(leads.data ?? []).filter((l) => matchesFilter(l, c.key)).length}
                </button>
              ))}
            </div>

            {leads.isLoading ? <p className="sk-state">Reading the enquiries…</p> : null}
            {leads.error ? <p className="sk-state err">{(leads.error as Error).message}</p> : null}

            {!leads.isLoading && !leads.error && rows.length === 0 ? (
              <p className="sk-state">
                {(leads.data ?? []).length === 0
                  ? 'No enquiries yet — they appear here the moment somebody submits the form on your website.'
                  : 'Nothing matches.'}
              </p>
            ) : null}

            {rows.length > 0 ? (
              <div className="sk-enq-list" role="listbox" aria-label="Leads">
                {rows.map((l) => {
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
                        {due ? <span className="sk-enq-due" data-tone={due.tone}>{due.text}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div>{selected ? <LeadPanel id={selected} /> : <p className="sk-state">Pick a family on the left.</p>}</div>
      </div>
    </div>
  );
}
