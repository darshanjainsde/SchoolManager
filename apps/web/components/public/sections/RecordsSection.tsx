'use client';
/**
 * The Book of Records page — four rooms for the same lines. Every room marks
 * the verified record apart from the all-time bests, draws its panels with
 * .ps-panel (so the school's shape control reaches it) and wears the school's
 * two colours. Nothing here knows a child's id, class or date of birth: the
 * API already formatted the names the school chose.
 */
import { useMemo, useState } from 'react';
import type { RecordLine, RecordsBook } from '@/lib/public-api';

export type RecordsPageLayout = 'SCOREBOARD' | 'REGISTER' | 'CABINET' | 'PROGRESSION';

interface Props {
  book: RecordsBook;
  layout: RecordsPageLayout;
  showTopFive: boolean;
  schoolName: string;
  onOwnPage?: boolean;
}

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** Sports in the book, in order, for the filter chips. */
export function sportsOf(lines: RecordLine[]): string[] {
  return [...new Set(lines.map((l) => l.sportName))];
}

export default function RecordsSection({ book, layout, showTopFive, schoolName, onOwnPage = false }: Props) {
  const [sport, setSport] = useState<string>('');
  const sports = useMemo(() => sportsOf(book.lines), [book.lines]);
  const lines = sport ? book.lines.filter((l) => l.sportName === sport) : book.lines;
  const cls = layout === 'SCOREBOARD' ? 'ps-rec-sb' : layout === 'REGISTER' ? 'ps-rec-reg' : layout === 'PROGRESSION' ? 'ps-rec-prog' : 'ps-rec-cab';
  return (
    <section id="records" data-sec="records" className={`ps-rec ${cls} ${onOwnPage ? 'ps-rec-page' : ''}`.trim()} aria-labelledby="ps-rec-title">
      <div className={`max-w-6xl mx-auto px-6 ${onOwnPage ? 'pt-10 pb-20' : 'py-16'}`}>
        <header className="ps-rec-head">
          <p className="ps-eyebrow ps-rec-eyebrow">{layout === 'REGISTER' ? 'Register of records' : 'Book of Records'}</p>
          <h2 id="ps-rec-title" className="ps-head ps-rec-h">
            {layout === 'SCOREBOARD' ? `${schoolName} school records` : layout === 'REGISTER' ? `${schoolName} · the record book` : layout === 'PROGRESSION' ? 'How far we have come' : 'Our record holders'}
          </h2>
          <p className="ps-rec-sub">
            {layout === 'REGISTER' ? 'Kept by the sports desk. A record enters the book only when it is verified.' : 'Verified records on every line the school runs.'}
            {showTopFive ? ' The all-time bests are the best marks ever set at our meets.' : ''}
          </p>
        </header>

        {book.lines.length === 0 ? (
          <p className="ps-rec-empty">The book opens at the first meet.</p>
        ) : (
          <>
            {sports.length > 1 && (
              <div className="ps-rec-tabs" role="group" aria-label="Sport">
                <button type="button" className="ps-rec-tab" aria-pressed={sport === ''} onClick={() => setSport('')}>All</button>
                {sports.map((s) => (
                  <button key={s} type="button" className="ps-rec-tab" aria-pressed={sport === s} onClick={() => setSport(s)}>{s}</button>
                ))}
              </div>
            )}
            {layout === 'SCOREBOARD' && <Scoreboard lines={lines} showTopFive={showTopFive} />}
            {layout === 'REGISTER' && <Register lines={lines} showTopFive={showTopFive} />}
            {layout === 'CABINET' && <Cabinet lines={lines} showTopFive={showTopFive} />}
            {layout === 'PROGRESSION' && <Progression lines={lines} showTopFive={showTopFive} />}
          </>
        )}
      </div>
    </section>
  );
}

const lineLabel = (l: RecordLine) => `${l.groupLabel} · ${l.category}`;

function TopList({ l, showTopFive, variant }: { l: RecordLine; showTopFive: boolean; variant: 'bars' | 'list' | 'medals' }) {
  if (!showTopFive || l.top.length === 0) return null;
  const best = l.top[0].value;
  const worst = l.top[l.top.length - 1].value;
  const width = (v: number) => {
    if (best === worst) return 100;
    const t = l.lowerIsBetter ? (worst - v) / (worst - best) : (v - worst) / (best - worst);
    return Math.round(60 + 40 * Math.max(0, Math.min(1, t)));
  };
  return (
    <div className={`ps-rec-top ps-rec-top-${variant}`} aria-label={`All-time bests, ${l.sportName} ${lineLabel(l)}`}>
      <span className="ps-rec-toplab">All-time bests</span>
      {l.top.map((t, i) => (
        <div key={`${t.name}-${i}`} className="ps-rec-toprow" data-rec={l.record && t.value === l.record.value && t.name === l.record.name ? 'true' : undefined}>
          {variant === 'medals' ? <span className={`ps-rec-medal ${t.rank === 1 ? 'm1' : t.rank === 2 ? 'm2' : t.rank === 3 ? 'm3' : 'mn'}`} aria-hidden="true">{t.rank}</span> : <span className="ps-rec-rank">{t.rank}</span>}
          {variant === 'bars' ? <span className="ps-rec-bar" style={{ width: `${width(t.value)}%` }} aria-hidden="true" /> : null}
          <span className="ps-rec-topname">{t.name} <i>{t.year}</i></span>
          <span className="ps-rec-topval">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

function Scoreboard({ lines, showTopFive }: { lines: RecordLine[]; showTopFive: boolean }) {
  const [open, setOpen] = useState<string | null>(lines[0]?.key ?? null);
  return (
    <div className="ps-rec-rows">
      {lines.map((l) => (
        <div key={l.key} className="ps-rec-rowwrap">
          <button type="button" className="ps-rec-row ps-panel ps-panel-sm" aria-expanded={open === l.key} onClick={() => setOpen(open === l.key ? null : l.key)}>
            <span className="ps-rec-rowline"><b>{l.sportName}</b><span>{lineLabel(l)}</span></span>
            <span className="ps-rec-rowval">{l.record ? l.record.text : <em>no record yet</em>}</span>
            <span className="ps-rec-rowwho">{l.record?.name ?? '—'}</span>
            <span className="ps-rec-rowyr">{l.record?.year ?? ''}</span>
          </button>
          {open === l.key && (
            <div className="ps-rec-rowopen">
              {l.history.length > 0 && <p className="ps-rec-lineage"><i>Before:</i> {l.history.map((h) => `${h.text} ${h.name}, ${h.year}`).join(' → ')}</p>}
              <TopList l={l} showTopFive={showTopFive} variant="bars" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Register({ lines, showTopFive }: { lines: RecordLine[]; showTopFive: boolean }) {
  const chapters = new Map<string, RecordLine[]>();
  for (const l of lines) chapters.set(l.sportName, [...(chapters.get(l.sportName) ?? []), l]);
  return (
    <div className="ps-rec-chapters">
      {[...chapters.entries()].map(([sportName, ls], i) => (
        <section key={sportName} className="ps-rec-chapter" aria-label={sportName}>
          <h3 className="ps-head ps-rec-chapterh">{sportName} <small>Chapter {i + 1}</small></h3>
          <table className="ps-rec-table">
            <thead><tr><th>Line</th><th>Record</th><th>Holder</th><th>Held since</th></tr></thead>
            <tbody>
              {ls.map((l) => (
                <RegisterRows key={l.key} l={l} showTopFive={showTopFive} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function RegisterRows({ l, showTopFive }: { l: RecordLine; showTopFive: boolean }) {
  return (
    <>
      <tr>
        <td>{lineLabel(l)}</td>
        <td className="ps-rec-tv">{l.record ? <><span className="ps-rec-star" aria-label="verified record">★</span> {l.record.text}</> : <em>no record yet</em>}</td>
        <td>{l.record?.name ?? '—'}</td>
        <td>{l.record?.year ?? ''}</td>
      </tr>
      {(l.history.length > 0 || (showTopFive && l.top.length > 0)) && (
        <tr className="ps-rec-tr-note">
          <td colSpan={4}>
            {l.history.length > 0 && <span className="ps-rec-lineage"><i>Before:</i> {l.history.map((h) => `${h.text} ${h.name}, ${h.year}`).join(' → ')}{l.record ? ` → ${l.record.text} ${l.record.name}, ${l.record.year}` : ''}</span>}
            {showTopFive && l.top.length > 0 && <span className="ps-rec-lineage"><i>All-time bests:</i> {l.top.map((t) => `${t.rank} ${t.name} ${t.text}`).join(' · ')}</span>}
          </td>
        </tr>
      )}
    </>
  );
}

function Cabinet({ lines, showTopFive }: { lines: RecordLine[]; showTopFive: boolean }) {
  return (
    <div className="ps-rec-cards">
      {lines.map((l) => (
        <article key={l.key} className="ps-panel ps-rec-card" aria-label={`${l.sportName} ${lineLabel(l)}`}>
          <p className="ps-eyebrow ps-rec-eyebrow">{l.sportName}</p>
          <h3 className="ps-head ps-rec-cardh">{lineLabel(l)}</h3>
          {l.record ? (
            <div className="ps-rec-gold">
              <span className="ps-rec-medal m1 lg" aria-hidden="true">REC</span>
              <span className="ps-rec-goldwho"><b>{l.record.name}</b><span>Record since {l.record.year}</span></span>
              <span className="ps-rec-goldval">{l.record.text}</span>
            </div>
          ) : (
            <p className="ps-rec-nonyet">No verified record on this line yet.</p>
          )}
          {showTopFive && l.top.length > 0 && (
            <div className="ps-rec-top ps-rec-top-medals" aria-label={`All-time bests, ${l.sportName} ${lineLabel(l)}`}>
              <span className="ps-rec-toplab">All-time bests</span>
              {l.top.filter((t) => !(l.record && t.rank === 1 && t.name === l.record.name && t.value === l.record.value)).map((t, i) => (
                <div key={`${t.name}-${i}`} className="ps-rec-toprow">
                  <span className={`ps-rec-medal ${t.rank === 1 ? 'm1' : t.rank === 2 ? 'm2' : t.rank === 3 ? 'm3' : 'mn'}`} aria-hidden="true">{t.rank}</span>
                  <span className="ps-rec-topname">{t.name} <i>{t.year}</i></span>
                  <span className="ps-rec-topval">{t.text}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

/** The record over the years as a step line: better is always UP, whichever way the sport counts. */
export function progressionPath(l: RecordLine, w = 320, h = 100): { d: string; pts: { x: number; y: number; text: string; year: number; now: boolean }[] } {
  const rows = [...l.history.map((x) => ({ value: x.value, text: x.text, year: x.year })), ...(l.record ? [{ value: l.record.value, text: l.record.text, year: l.record.year }] : [])];
  if (rows.length === 0) return { d: '', pts: [] };
  const vals = rows.map((r) => r.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = 26;
  const y = (v: number) => {
    if (hi === lo) return h / 2;
    const better = l.lowerIsBetter ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
    return Math.round(h - 18 - better * (h - 36));
  };
  const x = (i: number) => (rows.length === 1 ? w / 2 : Math.round(pad + (i * (w - 2 * pad)) / (rows.length - 1)));
  const pts = rows.map((r, i) => ({ x: x(i), y: y(r.value), text: r.text, year: r.year, now: i === rows.length - 1 && !!l.record }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${pts[i].x} V ${pts[i].y}`;
  return { d, pts };
}

function Progression({ lines, showTopFive }: { lines: RecordLine[]; showTopFive: boolean }) {
  return (
    <div className="ps-rec-lines">
      {lines.map((l) => {
        const { d, pts } = progressionPath(l);
        return (
          <article key={l.key} className="ps-panel ps-rec-line" aria-label={`${l.sportName} ${lineLabel(l)}`}>
            <div className="ps-rec-chart">
              <p className="ps-eyebrow ps-rec-eyebrow">{l.sportName} · {lineLabel(l)}</p>
              <p className="ps-rec-cur">{l.record ? <><span className="ps-rec-curval">{l.record.text}</span><span className="ps-rec-curwho">{l.record.name} · held since {l.record.year}</span></> : <span className="ps-rec-curwho">No verified record yet</span>}</p>
              {pts.length > 0 && (
                <svg viewBox="0 0 320 110" role="img" aria-label={`Record progression: ${pts.map((p) => `${p.text} in ${p.year}`).join(', ')}`} className="ps-rec-svg">
                  <line x1="20" y1="88" x2="300" y2="88" className="ps-rec-axis" />
                  <path d={d} className="ps-rec-path" />
                  {pts.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r={p.now ? 5 : 4} className={p.now ? 'ps-rec-dot-now' : 'ps-rec-dot'} />
                      <text x={p.x} y={p.y - 9} textAnchor="middle" className="ps-rec-svgval">{p.text.replace(/ [a-z]+$/i, '')}</text>
                      <text x={p.x} y={102} textAnchor="middle" className="ps-rec-svgyr">{p.year}</text>
                    </g>
                  ))}
                </svg>
              )}
            </div>
            <TopList l={l} showTopFive={showTopFive} variant="list" />
          </article>
        );
      })}
    </div>
  );
}
