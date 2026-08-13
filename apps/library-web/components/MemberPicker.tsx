'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  initials,
  memberHue,
  memberName,
  searchMembers,
  statusTone,
  type Ctx,
  type MemberCard,
} from '@/lib/members';

interface Props {
  ctx: Ctx;
  selected: MemberCard | null;
  onSelect: (member: MemberCard | null) => void;
  /** Called after a pick so the desk can put focus back on the accessionNumber field. */
  onPicked?: () => void;
}

/**
 * Find-a-person for the circulation desk.
 *
 * Keyboard-first on purpose: a desk is worked with both hands busy, so the
 * whole flow — type, arrow down, Enter — never needs the mouse, and Escape
 * abandons without clearing the current member.
 */
export function MemberPicker({ ctx, selected, onSelect, onPicked }: Props) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MemberCard[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // One in-flight search. Without this a fast typist's earlier request can
  // resolve after a later one and repopulate the list with staler results.
  const inflight = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const run = useCallback(
    async (query: string) => {
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      setError(null);
      try {
        const found = await searchMembers(ctx, query, { limit: 8, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        setHits(found);
        setCursor(0);
      } catch (err) {
        if (ctrl.signal.aborted) return; // superseded, not a failure
        setHits([]);
        setError(err instanceof ApiError ? err.message : 'Could not reach the library.');
      }
    },
    [ctx],
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void run(q), q ? 180 : 0);
    return () => clearTimeout(t);
  }, [q, open, run]);

  // Clicking away closes the list without disturbing the current selection.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(m: MemberCard) {
    onSelect(m);
    setQ('');
    setHits([]);
    setOpen(false);
    onPicked?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hits[cursor]) pick(hits[cursor]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  if (selected) {
    const tone = statusTone(selected.status);
    return (
      <div className="lbx-member-chosen">
        <span
          className="lbx-disc"
          style={{ background: `hsl(${memberHue(selected.id)} 45% 40%)` }}
          aria-hidden="true"
        >
          {initials(selected)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="lbx-member-name">{memberName(selected)}</div>
          <div className="lbx-member-meta">
            <span className="lbx-mono">{selected.code}</span>
            {tone !== 'ok' ? (
              <span className={`lbx-pill ${tone}`}>
                {selected.status === 'SUSPENDED' ? 'Suspended' : 'Not yet active'}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="lbx-btn ghost"
          onClick={() => {
            onSelect(null);
            setOpen(true);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="lbx-picker" ref={boxRef}>
      <label htmlFor="member-q" className="lbx-picker-label">
        Member
      </label>
      <input
        id="member-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Name or code — Menon, RAF-00042, 42"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="member-hits"
        aria-autocomplete="list"
      />

      {error ? (
        <div className="lbx-error" role="alert" style={{ marginTop: '.4rem' }}>
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </div>
      ) : null}

      {open && hits.length > 0 ? (
        <ul className="lbx-hits" id="member-hits" role="listbox">
          {hits.map((m, i) => {
            const tone = statusTone(m.status);
            return (
              <li key={m.id} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  className={`lbx-hit${i === cursor ? ' on' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(m)}
                >
                  <span
                    className="lbx-disc sm"
                    style={{ background: `hsl(${memberHue(m.id)} 45% 40%)` }}
                    aria-hidden="true"
                  >
                    {initials(m)}
                  </span>
                  <span className="lbx-hit-name">{memberName(m)}</span>
                  <span className="lbx-hit-code lbx-mono">{m.code}</span>
                  {tone !== 'ok' ? <span className={`lbx-pill ${tone}`}>{m.status.toLowerCase()}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open && q && hits.length === 0 && !error ? (
        <p className="lbx-hits-empty">Nobody matches “{q}”.</p>
      ) : null}
    </div>
  );
}
