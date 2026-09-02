'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { ConsoleSearch } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { rupees } from '@/lib/fees';

/**
 * The command bar — the Front Desk's front door.
 *
 * Type a name, an admission number, a register serial, or an action word;
 * every hit carries its own one-tap follow-ups (a student's row shows their
 * LIVE fee balance), and ↑↓ + Enter drive it without a mouse. `/` focuses it
 * from anywhere in the console (wired in the layout).
 *
 * The people index is the API's (`/manage/search`, debounced 200 ms); the
 * ACTION index is this client-side registry — screens and drawers the office
 * reaches for, fuzzy-matched by word.
 */

export interface BarAction {
  label: string;
  hint: string;
  keywords: string;
  run: () => void;
}

type Hit =
  | { kind: 'student'; s: ConsoleSearch['students'][number] }
  | { kind: 'teacher'; t: ConsoleSearch['teachers'][number] }
  | { kind: 'staff'; t: ConsoleSearch['staff'][number] }
  | { kind: 'serial'; r: ConsoleSearch['serials'][number] }
  | { kind: 'action'; a: BarAction };

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandBar({ actions }: { actions: BarAction[] }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q, 200);

  // The layout dispatches this when "/" is pressed anywhere in the console.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener('sk-focus-command-bar', focus);
    return () => window.removeEventListener('sk-focus-command-bar', focus);
  }, []);

  const search = useQuery({
    queryKey: ['console-search', host, debounced], enabled: !!host && debounced.trim().length >= 2,
    queryFn: () => api.get<ConsoleSearch>(`/manage/search?q=${encodeURIComponent(debounced.trim())}`),
    staleTime: 30_000,
  });

  const hits: Hit[] = useMemo(() => {
    const out: Hit[] = [];
    const query = q.trim().toLowerCase();
    if (query.length < 2) return out;
    const d = search.data;
    for (const s of d?.students ?? []) out.push({ kind: 'student', s });
    for (const a of actions) {
      if (a.keywords.includes(query) || a.label.toLowerCase().includes(query)) out.push({ kind: 'action', a });
    }
    for (const t of d?.teachers ?? []) out.push({ kind: 'teacher', t });
    for (const t of d?.staff ?? []) out.push({ kind: 'staff', t });
    for (const r of d?.serials ?? []) out.push({ kind: 'serial', r });
    return out.slice(0, 12);
  }, [q, search.data, actions]);

  useEffect(() => { setSel(0); }, [debounced]);

  function runHit(h: Hit) {
    setOpen(false);
    setQ('');
    if (h.kind === 'student') router.push(`/app/students/${h.s.id}`);
    else if (h.kind === 'teacher') router.push('/app/teachers');
    else if (h.kind === 'staff') router.push('/app/staff');
    else if (h.kind === 'serial') router.push(`/app/press/register?q=${encodeURIComponent(h.r.serial)}`);
    else h.a.run();
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        className="sk-card"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
          borderColor: open ? 'var(--sk-brand)' : undefined,
        }}
      >
        <Search size={16} style={{ color: 'var(--sk-brand-2)', flex: 'none' }} aria-hidden="true" />
        <input
          ref={inputRef}
          value={q}
          placeholder="Search a child, a serial, an action…  ( / )"
          aria-label="Search the console"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', font: 'inherit', color: 'var(--sk-ink)' }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
            if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); runHit(hits[sel]!); }
          }}
        />
      </div>

      {open && q.trim().length >= 2 && (
        <div
          className="sk-card"
          role="listbox"
          style={{
            position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)', zIndex: 40,
            padding: 6, maxHeight: 420, overflowY: 'auto',
          }}
        >
          {search.isLoading && <p className="sk-state" style={{ padding: 8, margin: 0 }}>Looking…</p>}
          {!search.isLoading && hits.length === 0 && (
            <p className="sk-state" style={{ padding: 8, margin: 0 }}>
              Nothing matches — try a name, an admission number, or a serial like TC/2026.
            </p>
          )}
          {hits.map((h, i) => {
            const rowStyle: React.CSSProperties = {
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              padding: '8px 10px', borderRadius: 9, fontSize: 13.5,
              background: i === sel ? 'var(--sk-brand-tint)' : undefined, cursor: 'pointer',
            };
            if (h.kind === 'student') {
              return (
                <div key={`s${h.s.id}`} role="option" aria-selected={i === sel} style={rowStyle}
                  onMouseDown={() => runHit(h)} onMouseEnter={() => setSel(i)}>
                  <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--sk-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800, flex: 'none' }}>
                    {h.s.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  </span>
                  <span style={{ fontWeight: 650 }}>{h.s.name}</span>
                  <span className="sk-muted" style={{ fontSize: 11.5 }}>
                    {[h.s.classLabel, h.s.rollNo ? `Roll ${h.s.rollNo}` : null, h.s.admissionNo].filter(Boolean).join(' · ')}
                    {!h.s.isActive && ' · left'}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className="sk-pill" data-tone="info">Open 360</span>
                    {h.s.feesDueMinor > 0 && (
                      <Link href={`/app/fees/students/${h.s.id}`} className="sk-pill" data-tone="warn"
                        onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)}>
                        Fees {rupees(h.s.feesDueMinor)} due
                      </Link>
                    )}
                  </span>
                </div>
              );
            }
            if (h.kind === 'action') {
              return (
                <div key={`a${h.a.label}`} role="option" aria-selected={i === sel} style={rowStyle}
                  onMouseDown={() => runHit(h)} onMouseEnter={() => setSel(i)}>
                  <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)', display: 'grid', placeItems: 'center', fontSize: 11, flex: 'none' }}>▶</span>
                  <span style={{ fontWeight: 650 }}>{h.a.label}</span>
                  <span className="sk-muted" style={{ fontSize: 11.5 }}>{h.a.hint}</span>
                </div>
              );
            }
            const label = h.kind === 'teacher' ? h.t.name : h.kind === 'staff' ? h.t.name : h.r.serial;
            const meta = h.kind === 'teacher' ? 'Teacher' : h.kind === 'staff' ? `Staff · ${h.t.role}` : `${h.r.studentName} · register`;
            return (
              <div key={`${h.kind}${label}`} role="option" aria-selected={i === sel} style={rowStyle}
                onMouseDown={() => runHit(h)} onMouseEnter={() => setSel(i)}>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--sk-bg-2)', color: 'var(--sk-ink-2)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, flex: 'none' }}>
                  {h.kind === 'serial' ? '#' : label.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                </span>
                <span style={{ fontWeight: 650 }} className={h.kind === 'serial' ? 'sk-num' : undefined}>{label}</span>
                <span className="sk-muted" style={{ fontSize: 11.5 }}>{meta}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
