'use client';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '@/lib/z-layers';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * ONE DATE FIELD FOR THE CONSOLE.
 *
 * The browser's own date input looks different in every browser, reads
 * mm/dd/yyyy on some machines, and makes a date of birth a chore: forty taps
 * of "previous month", or a year spinner. Offices type dates the Indian way,
 * so this field takes TYPING first — "14091999" becomes 14/09/1999 as it is
 * typed — and the calendar is the second way in: month and year are two
 * dropdowns, so 1987 is one pick, not 470 clicks.
 *
 * A drop-in for `<input type="date">`: the value in and out is 'YYYY-MM-DD',
 * or '' for none. Monday-first, like the diary and attendance calendars.
 *
 * The calendar is portalled to <body> and placed against the field with fixed
 * coordinates, clamped to the window. Inline, it was cut off by any card that
 * clips, ran off the right edge when the field sat in a right-hand column
 * (measured: 48px past a 768px window), and a page-entrance transform would
 * have trapped a fixed overlay (UI ledger `fixed-overlay-inline-in-an-animated-page`).
 *
 * The portal carries `.skosx`, like the kit's Overlay: every `--sk-*` colour is
 * scoped to that class, so a calendar outside it had no background and no ink —
 * it opened see-through, and read as "the calendar does not show" (2026-10-07).
 */
export interface DateFieldProps {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  /** Earliest / latest pickable day, 'YYYY-MM-DD'. Bounds the year list too. */
  min?: string;
  max?: string;
  /** The month the calendar opens on when the field is empty, 'YYYY-MM' (a date of birth opens decades back). */
  openTo?: string;
  invalid?: boolean;
  describedBy?: string;
  /** The input's class — the caller's own field style. */
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** 'YYYY-MM-DD' → parts, or null when it is not a real calendar day. */
export function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!r) return null;
  const y = +r[1], m = +r[2] - 1, d = +r[3];
  if (m < 0 || m > 11 || d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

/** What an office types → 'YYYY-MM-DD', or null. Day first: 14/9/1999, 14-09-1999, 14.09.1999, and an ISO date. */
export function parseTyped(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (parseIso(t)) return t;
  const r = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (!r) return null;
  const iso = isoOf(+r[3], +r[2] - 1, +r[1]);
  return parseIso(iso) ? iso : null;
}

/** 'YYYY-MM-DD' → '14/09/1999'. */
export function displayOf(iso: string): string {
  const p = parseIso(iso);
  return p ? `${pad(p.d)}/${pad(p.m + 1)}/${p.y}` : '';
}

/** As digits are typed, put the slashes in: "1409" → "14/09", "14091999" → "14/09/1999". */
export function autoSlash(raw: string): string {
  if (/[^\d/]/.test(raw)) return raw; // someone typing "14-09-1999" or "1999-09-14" — leave it alone
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

function todayIso(): string {
  const n = new Date();
  return isoOf(n.getFullYear(), n.getMonth(), n.getDate());
}

export function DateField({ id, value, onChange, min = '1940-01-01', max = '2045-12-31', openTo, invalid, describedBy, className, disabled, 'aria-label': ariaLabel }: DateFieldProps) {
  const [text, setText] = useState(() => displayOf(value));
  const [typedBad, setTypedBad] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const popRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const hintId = useId();

  // The value can change from outside (a reset, an edit form opening).
  useEffect(() => {
    setText(displayOf(value));
    setTypedBad(false);
  }, [value]);

  const lo = parseIso(min) ?? { y: 1940, m: 0, d: 1 };
  const hi = parseIso(max) ?? { y: 2045, m: 11, d: 31 };

  // The month on show, and the day the keyboard is on.
  const start = useMemo(() => {
    const v = parseIso(value);
    if (v) return v;
    const o = openTo && /^(\d{4})-(\d{2})$/.exec(openTo);
    if (o) return { y: +o[1], m: +o[2] - 1, d: 1 };
    const t = parseIso(todayIso())!;
    return t.y < lo.y ? lo : t.y > hi.y ? hi : t;
  }, [value, openTo, lo.y, hi.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [focusDay, setFocusDay] = useState(start.d);

  const show = () => {
    if (disabled) return;
    setView({ y: start.y, m: start.m });
    setFocusDay(start.d);
    setOpen(true);
  };
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) inputRef.current?.focus();
  };

  // Click outside (the field AND the portalled calendar) closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Place the calendar against the field: below it, or above when the window
  // has no room underneath; never past either side. Follows scroll and resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(304, window.innerWidth - 32);
      const h = popRef.current?.offsetHeight || 360;
      const left = Math.max(16, Math.min(r.left, window.innerWidth - w - 16));
      const below = window.innerHeight - r.bottom;
      const up = below < h + 12 && r.top > below;
      setPos(up ? { left, bottom: window.innerHeight - r.top + 6, width: w } : { left, top: r.bottom + 6, width: w });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  // Keep keyboard focus on the active day while the calendar is open.
  useEffect(() => {
    if (!open) return;
    const btn = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`);
    if (btn && gridRef.current?.contains(document.activeElement)) btn.focus();
  }, [open, focusDay, view]);

  const inRange = (iso: string) => iso >= isoOf(lo.y, lo.m, lo.d) && iso <= isoOf(hi.y, hi.m, hi.d);
  const pick = (iso: string) => {
    if (!inRange(iso)) return;
    onChange(iso);
    setText(displayOf(iso));
    setTypedBad(false);
    close(true);
  };

  const commitTyped = () => {
    if (!text.trim()) { setTypedBad(false); if (value) onChange(''); return; }
    const iso = parseTyped(text);
    if (iso && inRange(iso)) { setTypedBad(false); setText(displayOf(iso)); if (iso !== value) onChange(iso); }
    else setTypedBad(true);
  };

  const moveMonth = (delta: number) => {
    setView((v) => {
      let m = v.m + delta, y = v.y;
      while (m < 0) { m += 12; y -= 1; }
      while (m > 11) { m -= 12; y += 1; }
      if (y < lo.y || (y === lo.y && m < lo.m)) return v;
      if (y > hi.y || (y === hi.y && m > hi.m)) return v;
      setFocusDay((d) => Math.min(d, daysIn(y, m)));
      return { y, m };
    });
  };

  const onGridKey = (e: KeyboardEvent) => {
    const dim = daysIn(view.y, view.m);
    const step = (n: number) => {
      const next = focusDay + n;
      if (next < 1) { moveMonth(-1); setFocusDay(daysIn(view.m === 0 ? view.y - 1 : view.y, (view.m + 11) % 12) + next); }
      else if (next > dim) { moveMonth(1); setFocusDay(next - dim); }
      else setFocusDay(next);
    };
    const keys: Record<string, () => void> = {
      ArrowLeft: () => step(-1), ArrowRight: () => step(1), ArrowUp: () => step(-7), ArrowDown: () => step(7),
      PageUp: () => moveMonth(e.shiftKey ? -12 : -1), PageDown: () => moveMonth(e.shiftKey ? 12 : 1),
      Home: () => setFocusDay(1), End: () => setFocusDay(dim),
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  };

  // The month grid: blanks before the 1st (Monday-first), then each day.
  const lead = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7;
  const dim = daysIn(view.y, view.m);
  const today = todayIso();
  const years: number[] = [];
  for (let y = hi.y; y >= lo.y; y--) years.push(y);

  const bad = invalid || typedBad;
  // A step past a bound leaves the month where it was; never let the roving day fall off the grid.
  const activeDay = Math.min(Math.max(focusDay, 1), dim);
  return (
    // Escape closes from anywhere in the field or its calendar, back to the input.
    <div ref={wrapRef} className="sk-dfield" data-open={open || undefined} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(true); } }}>
      <input
        ref={inputRef}
        id={id}
        className={className}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        aria-describedby={[describedBy, typedBad ? hintId : null].filter(Boolean).join(' ') || undefined}
        onChange={(e) => { setText(autoSlash(e.target.value)); setTypedBad(false); }}
        onBlur={commitTyped}
        onClick={() => { if (!open) show(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitTyped(); }
          else if ((e.key === 'ArrowDown' && e.altKey) || (e.key === 'ArrowDown' && !text)) { e.preventDefault(); show(); setTimeout(() => gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus(), 0); }
        }}
      />
      <button type="button" className="sk-dfield-btn" aria-label={open ? 'Close calendar' : 'Open calendar'} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popId : undefined} tabIndex={-1} disabled={disabled} onClick={() => {
        if (open) { close(true); return; }
        show();
        // Opened on purpose: keyboard focus goes to the day, so arrows work at once.
        setTimeout(() => gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus(), 0);
      }}>
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
      </button>
      {typedBad && <span id={hintId} className="sk-dfield-hint">Type the date as dd/mm/yyyy, e.g. 14/09/1999{max !== '2045-12-31' ? `, no later than ${displayOf(max)}` : ''}.</span>}

      {open && typeof document !== 'undefined' && createPortal(
        <div ref={popRef} id={popId} className="skosx sk-dfield-pop" style={{ ...pos, zIndex: Z.OVERLAY }} role="dialog" aria-label="Choose a date">
          <div className="sk-dfield-head">
            <button type="button" className="sk-dfield-nav" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
            <select aria-label="Month" value={view.m} onChange={(e) => { const m = +e.target.value; setView((v) => ({ ...v, m })); setFocusDay((d) => Math.min(d, daysIn(view.y, m))); }}>
              {MONTHS.map((name, i) => (
                <option key={name} value={i} disabled={(view.y === lo.y && i < lo.m) || (view.y === hi.y && i > hi.m)}>{name}</option>
              ))}
            </select>
            <select aria-label="Year" value={view.y} onChange={(e) => { const y = +e.target.value; setView((v) => ({ y, m: y === lo.y ? Math.max(v.m, lo.m) : y === hi.y ? Math.min(v.m, hi.m) : v.m })); }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" className="sk-dfield-nav" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <div ref={gridRef} className="sk-dfield-grid" role="grid" aria-label={`${MONTHS[view.m]} ${view.y}`} onKeyDown={onGridKey}>
            {WEEKDAYS.map((w) => <span key={w} className="wd" role="columnheader" aria-label={w}>{w}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} aria-hidden="true" />)}
            {Array.from({ length: dim }, (_, i) => {
              const d = i + 1;
              const iso = isoOf(view.y, view.m, d);
              const off = !inRange(iso);
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  data-day={d}
                  tabIndex={d === activeDay ? 0 : -1}
                  disabled={off}
                  aria-selected={iso === value}
                  aria-label={`${d} ${MONTHS[view.m]} ${view.y}`}
                  data-today={iso === today || undefined}
                  onClick={() => pick(iso)}
                  onFocus={() => setFocusDay(d)}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="sk-dfield-foot">
            {/* A date of birth can never be today: offer the shortcut only where it can be picked. */}
            {inRange(today) ? <button type="button" className="sk-dfield-link" onClick={() => pick(today)}>Today</button> : <span />}
            {value && <button type="button" className="sk-dfield-link" onClick={() => { onChange(''); setText(''); close(true); }}>Clear</button>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
