import type { SyllabusPace, SyllabusStatus, SyllabusTrackSummary } from '@skoolos/types';

/** Words for the codes. Nothing from the API reaches a screen as a code. */
export const PACE_LABEL: Record<SyllabusPace, string> = { ok: 'On pace', warn: 'Slightly behind', bad: 'Behind', none: 'No chapters' };
export const PACE_TONE: Record<SyllabusPace, 'good' | 'warn' | 'bad' | 'neutral'> = { ok: 'good', warn: 'warn', bad: 'bad', none: 'neutral' };
export const STATUS_LABEL: Record<SyllabusStatus, string> = { NOT_STARTED: 'Not started', TEACHING: 'Teaching', DONE: 'Done' };
export const STATUS_TONE: Record<SyllabusStatus, 'good' | 'info' | 'neutral'> = { NOT_STARTED: 'neutral', TEACHING: 'info', DONE: 'good' };

/** "14 pts behind" / "3 pts ahead" / "on the line" */
export function gapLine(t: Pick<SyllabusTrackSummary, 'pct' | 'expectedPct' | 'leaves'>): string {
  if (!t.leaves) return 'nothing to measure';
  const gap = t.expectedPct - t.pct;
  if (gap > 0) return `${gap} pts behind`;
  if (gap < 0) return `${-gap} pts ahead`;
  return 'on the line';
}

/** Worst first: behind, then slightly behind, then on pace; within a band the biggest gap first; empty tracks last. */
export function worstFirst(a: SyllabusTrackSummary, b: SyllabusTrackSummary): number {
  const rank: Record<SyllabusPace, number> = { bad: 0, warn: 1, ok: 2, none: 3 };
  if (rank[a.pace] !== rank[b.pace]) return rank[a.pace] - rank[b.pace];
  return (b.expectedPct - b.pct) - (a.expectedPct - a.pct) || a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName);
}

/** "8 Oct" style, in words a teacher reads at a glance; null → "never". */
export function sinceLine(iso: string | null): string {
  if (!iso) return 'Not started';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
}
