import type { SyllabusPace, SyllabusStatus } from '@skoolos/types';
import type { ColorPalette } from '@/theme/tokens';

/** Words for the codes, shared by every syllabus screen. No code reaches a screen. */
export const PACE_LABEL: Record<SyllabusPace, string> = { ok: 'On pace', warn: 'Slightly behind', bad: 'Behind', none: 'No chapters' };
export const PACE_TONE: Record<SyllabusPace, 'green' | 'amber' | 'red' | 'neutral'> = { ok: 'green', warn: 'amber', bad: 'red', none: 'neutral' };
export const STATUS_LABEL: Record<SyllabusStatus, string> = { NOT_STARTED: 'Not started', TEACHING: 'Teaching', DONE: 'Done' };
export const STATUS_TONE: Record<SyllabusStatus, 'green' | 'indigo' | 'neutral'> = { NOT_STARTED: 'neutral', TEACHING: 'indigo', DONE: 'green' };
export const STATUS_OPTIONS = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'TEACHING', label: 'Teaching' },
  { value: 'DONE', label: 'Done' },
] as const;

/** The ring colours, from the palette so dark mode follows. */
export function ringColors(c: ColorPalette) {
  return { taught: c.green, expected: c.indigo, revised: c.blue };
}

/** "14 pts behind" / "3 pts ahead" / "on the line" */
export function gapLine(t: { pct: number; expectedPct: number; leaves: number }): string {
  if (!t.leaves) return 'Nothing to measure yet';
  const gap = t.expectedPct - t.pct;
  if (gap > 0) return `${gap} pts behind`;
  if (gap < 0) return `${-gap} pts ahead`;
  return 'On the line';
}
