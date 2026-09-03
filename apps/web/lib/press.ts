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
  document.body.classList.add('press-printing');
  const done = () => {
    document.body.classList.remove('press-printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // Safari never fires afterprint from a cancelled dialog.
  window.setTimeout(done, 60_000);
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
