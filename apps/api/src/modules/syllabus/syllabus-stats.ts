import type { SyllabusPace, SyllabusStatus } from '@skoolos/types';

/**
 * The arithmetic behind every ring, in one place and with no database.
 *
 * A LEAF is the unit of teaching: a chapter's sub-topics when it has any,
 * otherwise the chapter itself. A chapter with sub-topics carries no status of
 * its own — it is DONE when all its leaves are, TEACHING while any is touched.
 *
 * "Expected by today" is the share of the year's WORKING days already gone,
 * so a Diwali break moves nobody behind. Pace is the gap between taught and
 * expected: up to 5 points behind is on pace (a chapter's worth of slack), up
 * to 15 is slightly behind, beyond that is behind. A track with no chapters
 * has no pace — nothing to measure, and the UI says so rather than showing 0%.
 */
export const PACE_WARN_AFTER = 5;
export const PACE_BAD_AFTER = 15;

export interface LeafState {
  id: string;
  title: string;
  status: SyllabusStatus;
}

export interface ChapterNode<L extends LeafState = LeafState> extends LeafState {
  children: L[];
}

/** The leaves of one chapter, in teaching order. */
export function leavesOf<L extends LeafState>(ch: ChapterNode<L>): LeafState[] {
  return ch.children.length ? ch.children : [ch];
}

/** Every leaf of a track, chapters in order, sub-topics in order. */
export function allLeaves<L extends LeafState>(chapters: ChapterNode<L>[]): LeafState[] {
  return chapters.flatMap((c) => leavesOf(c));
}

/** A chapter's own standing, derived from its sub-topics when it has any. */
export function chapterStatus<L extends LeafState>(ch: ChapterNode<L>): SyllabusStatus {
  if (!ch.children.length) return ch.status;
  const s = ch.children.map((c) => c.status);
  if (s.every((x) => x === 'DONE')) return 'DONE';
  if (s.some((x) => x !== 'NOT_STARTED')) return 'TEACHING';
  return 'NOT_STARTED';
}

export function paceOf(pct: number, expectedPct: number, leaves: number): SyllabusPace {
  if (leaves === 0) return 'none';
  const slip = expectedPct - pct;
  if (slip <= PACE_WARN_AFTER) return 'ok';
  if (slip <= PACE_BAD_AFTER) return 'warn';
  return 'bad';
}

export interface TrackStats {
  leaves: number;
  done: number;
  teaching: number;
  pct: number;
  pace: SyllabusPace;
  /** Where the class is: the leaf being taught, else the first not started. Null once everything is done. */
  now: { chapterId: string; title: string } | null;
}

export function trackStats<L extends LeafState>(chapters: ChapterNode<L>[], expectedPct: number): TrackStats {
  const leaves = allLeaves(chapters);
  const done = leaves.filter((l) => l.status === 'DONE').length;
  const teaching = leaves.filter((l) => l.status === 'TEACHING').length;
  const pct = leaves.length ? Math.round((done / leaves.length) * 100) : 0;
  const current = leaves.find((l) => l.status === 'TEACHING') ?? leaves.find((l) => l.status === 'NOT_STARTED') ?? null;
  return {
    leaves: leaves.length,
    done,
    teaching,
    pct,
    pace: paceOf(pct, expectedPct, leaves.length),
    now: current ? { chapterId: current.id, title: current.title } : null,
  };
}

/**
 * Share of the year gone, from the year's working dates (YYYY-MM-DD, sorted)
 * and today. Before the first day it is 0, after the last it is 100, and a
 * year with no working days at all reads as 0 rather than NaN.
 */
export function expectedPctOf(workingDates: readonly string[], today: string): number {
  if (!workingDates.length) return 0;
  const elapsed = workingDates.filter((d) => d <= today).length;
  return Math.round((elapsed / workingDates.length) * 100);
}

/**
 * "Reached here": every leaf before the target is DONE, the target is
 * TEACHING, and leaves after it are left as they are (a chapter taught out of
 * order stays done). The target must be a leaf.
 */
export function reachPlan<L extends LeafState>(chapters: ChapterNode<L>[], targetId: string): { before: string[]; target: string } | null {
  const ids = allLeaves(chapters).map((l) => l.id);
  const at = ids.indexOf(targetId);
  if (at < 0) return null;
  return { before: ids.slice(0, at), target: targetId };
}
