import type { PressDocType } from '@skoolos/types';

/** What the office reads on pills and in the register — never the raw enum. */
export const PRESS_TYPE_LABEL: Record<PressDocType, string> = {
  REPORT_CARD: 'Report card',
  TC: 'Transfer certificate',
  BONAFIDE: 'Bonafide certificate',
  CHARACTER: 'Character certificate',
};

/** 73.5 stays 73.5; 73.0 shows 73; null shows the honest dash. */
export function fmtMarks(n: number | null): string {
  if (n === null) return '—';
  const r = Math.round(n * 10) / 10;
  return String(r % 1 === 0 ? Math.trunc(r) : r);
}

export function pressDateLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/**
 * Print whatever currently lives in `#press-print` — the exam-hall recipe:
 * the class is worn only for the length of the print, so a stray Cmd+P still
 * prints the console the person is looking at.
 */
export function printPressSheets(): void {
  // NEVER open the dialog on an empty container.
  //
  // `BodyPrintPortal` gates on `useHydrated`, which is per-INSTANCE: a portal
  // that first mounts in the same commit as the print call renders `null` on
  // that commit and only appears one render later. A caller printing straight
  // after mounting one (the certificate desk: issue → fetch snapshot → print)
  // therefore printed a blank page — reproduced in `portal-race.test.tsx`.
  //
  // So the print waits for the sheets to actually exist, a frame at a time,
  // and gives up rather than printing nothing.
  const fire = (attempt: number): void => {
    const el = document.getElementById('press-print');
    if (!el || el.childElementCount === 0) {
      if (attempt < 30) {
        window.requestAnimationFrame(() => fire(attempt + 1));
        return;
      }
      // eslint-disable-next-line no-console -- a blank print run is worth saying out loud
      console.warn('[press] nothing to print — the sheet container never mounted');
      return;
    }
    document.body.classList.add('press-printing');
    const done = () => {
      document.body.classList.remove('press-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    // Safari never fires afterprint from a cancelled dialog.
    window.setTimeout(done, 60_000);
  };
  fire(0);
}

// ── Press Orders ─────────────────────────────────────────────────────────────

import type { PrintOrderStatus, PrintSpec } from '@skoolos/types';

/** What both desks read on the pill — never the raw status. */
export const ORDER_STATUS_LABEL: Record<PrintOrderStatus, string> = {
  REQUESTED: 'Requested',
  QUOTED: 'Quote ready',
  CONFIRMED: 'Confirmed',
  PRINTING: 'Printing',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
};

/** sk-pill tone per status: the school's next-action states glow. */
export const ORDER_STATUS_TONE: Record<PrintOrderStatus, 'good' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  REQUESTED: 'info',
  QUOTED: 'warn', // the school has a decision waiting
  CONFIRMED: 'info',
  PRINTING: 'info',
  DISPATCHED: 'info',
  DELIVERED: 'good',
  DECLINED: 'bad',
  CANCELLED: 'neutral',
};

const SIDES_LABEL = { SINGLE: 'one side', DOUBLE: 'both sides' } as const;
const FINISH_LABEL = {
  NONE: null, STAPLE: 'stapled', SPIRAL: 'spiral-bound', SADDLE: 'saddle-stitched', LAMINATE: 'laminated',
} as const;

/** "A4 · Colour · both sides · 130 gsm · stapled" — one line, plain words. */
export function specLabel(spec: PrintSpec): string {
  return [
    spec.size,
    spec.colour === 'BW' ? 'B&W' : 'Colour',
    SIDES_LABEL[spec.sides] ?? spec.sides,
    `${spec.gsm} gsm`,
    FINISH_LABEL[spec.finish] ?? null,
  ].filter(Boolean).join(' · ');
}

// ── Statutory wording helpers (Annexure-I prints dates and classes in words) ─

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const ORDINAL: Record<number, string> = {
  1: 'First', 2: 'Second', 3: 'Third', 5: 'Fifth', 8: 'Eighth', 9: 'Ninth', 12: 'Twelfth',
};

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function ordinalWord(n: number): string {
  if (ORDINAL[n]) return ORDINAL[n]!;
  const base = below100(n);
  if (base.endsWith('y')) return `${base.slice(0, -1)}ieth`;
  if (n > 20 && n % 10 !== 0) {
    const tens = TENS[Math.floor(n / 10)]!;
    return `${tens} ${ordinalWord(n % 10)}`;
  }
  return `${base}th`;
}

function yearInWords(y: number): string {
  const thousands = Math.floor(y / 1000);
  const rest = y % 1000;
  const hundreds = Math.floor(rest / 100);
  const tail = rest % 100;
  return [
    `${ONES[thousands]} Thousand`,
    hundreds ? `${ONES[hundreds]} Hundred` : '',
    tail ? below100(tail) : '',
  ].filter(Boolean).join(' ');
}

/** "2014-03-12" → "Twelfth March Two Thousand Fourteen" — Annexure field 6. */
export function dateInWords(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = Number(new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' }).format(d));
  const month = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' }).format(d);
  const year = Number(new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d));
  return `${ordinalWord(day)} ${month} ${yearInWords(year)}`;
}

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

/** "VII" / "Class 7" / "7" → "Seventh". Unparseable labels return ''. */
export function classInWords(label: string | null | undefined): string {
  if (!label) return '';
  const cleaned = label.replace(/^class\s+/i, '').trim();
  const n = ROMAN[cleaned.toUpperCase()] ?? (/^\d{1,2}$/.test(cleaned) ? Number(cleaned) : NaN);
  if (Number.isNaN(n) || n < 1 || n > 20) return '';
  return ordinalWord(n);
}

/** The office's chosen report-card template — a per-browser convenience.
 *  Presentation only: both templates render the same snapshot. */
export type PressTemplate = 'CLASSIC' | 'BOARD' | 'DETAILED';
export const PRESS_TEMPLATES: { id: PressTemplate; label: string }[] = [
  { id: 'DETAILED', label: 'Detailed' },
  { id: 'BOARD', label: 'Board pattern' },
  { id: 'CLASSIC', label: 'Classic' },
];
const TEMPLATE_KEY = 'sk-press-template';

export function getPressTemplate(): PressTemplate {
  try {
    const v = localStorage.getItem(TEMPLATE_KEY);
    return v === 'CLASSIC' || v === 'BOARD' ? v : 'DETAILED';
  } catch {
    return 'DETAILED';
  }
}

export function setPressTemplate(t: PressTemplate): void {
  try { localStorage.setItem(TEMPLATE_KEY, t); } catch { /* a picker that cannot remember still picks */ }
}
