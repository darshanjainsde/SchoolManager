import type { PressDocType } from '@skoolos/types';

/** What the office reads on pills and in the register — never the raw enum. */
export const PRESS_TYPE_LABEL: Record<PressDocType, string> = {
  REPORT_CARD: 'Report card',
  TC: 'Transfer certificate',
  BONAFIDE: 'Bonafide certificate',
  CHARACTER: 'Character certificate',
};

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
