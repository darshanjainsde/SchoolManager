import type { TenantTx } from '@skoolos/db';
import type { SyllabusChapterRow, SyllabusLeaf, SyllabusStatus, SyllabusYear } from '@skoolos/types';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { istTodayISO } from '../../common/dates/timetable-date';
// Through management's public index: module boundaries forbid reaching into internal/.
import { todayIstDateStr, workingDates } from '../management';
import { chapterStatus, expectedPctOf, type ChapterNode, type LeafState } from './syllabus-stats';

/**
 * Loaders shared by the teacher/admin service and the student service, so the
 * three audiences can never disagree about what a chapter list or a year's
 * progress looks like.
 */

export interface ChapterRecord {
  id: string;
  gradeId: string;
  subjectId: string;
  parentId: string | null;
  title: string;
  order: number;
  createdAt: Date;
}

export interface ProgressRecord {
  classSectionId: string;
  chapterId: string;
  status: SyllabusStatus;
  note: string | null;
  updatedAt: Date;
  updatedBy: { firstName: string; lastName: string } | null;
}

export const pairKey = (gradeId: string, subjectId: string) => `${gradeId}:${subjectId}`;
export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

const liveSlotWhere = (asOf: Date) => ({ effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] });
export { liveSlotWhere };

/** The year as the rings read it: dates as IST calendar days plus "expected by today". */
export async function describeYear(
  tx: TenantTx,
  schoolId: string,
  year: { id: string; name: string; startDate: Date; endDate: Date },
  today = istTodayISO(),
): Promise<SyllabusYear> {
  const startDate = todayIstDateStr(year.startDate);
  const endDate = todayIstDateStr(year.endDate);
  const days = startDate <= endDate ? await workingDates(tx, schoolId, startDate, endDate) : [];
  return { id: year.id, name: year.name, startDate, endDate, expectedPct: expectedPctOf(days, today) };
}

export async function currentYear(tx: TenantTx, schoolId: string) {
  return tx.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true, name: true, startDate: true, endDate: true } });
}

/** Live chapters for the given grades and subjects, oldest first within `order`. */
export async function loadChapters(tx: TenantTx, schoolId: string, where: { gradeIds?: string[]; subjectIds?: string[] } = {}): Promise<ChapterRecord[]> {
  return tx.syllabusChapter.findMany({
    take: LIST_CEILING.ROSTER,
    where: {
      schoolId,
      retiredAt: null,
      ...(where.gradeIds ? { gradeId: { in: where.gradeIds } } : {}),
      ...(where.subjectIds ? { subjectId: { in: where.subjectIds } } : {}),
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, gradeId: true, subjectId: true, parentId: true, title: true, order: true, createdAt: true },
  });
}

export async function loadProgress(tx: TenantTx, schoolId: string, sectionIds: string[]): Promise<ProgressRecord[]> {
  if (!sectionIds.length) return [];
  return tx.syllabusProgress.findMany({
    take: LIST_CEILING.ROSTER,
    where: { schoolId, classSectionId: { in: sectionIds } },
    select: {
      classSectionId: true,
      chapterId: true,
      status: true,
      note: true,
      updatedAt: true,
      updatedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

/** Chapters of one grade + subject, as a two-level tree. A sub-topic whose chapter is gone is dropped with it. */
export function treeOf(chapters: ChapterRecord[], gradeId: string, subjectId: string): { parent: ChapterRecord; children: ChapterRecord[] }[] {
  const mine = chapters.filter((c) => c.gradeId === gradeId && c.subjectId === subjectId);
  const parents = mine.filter((c) => !c.parentId);
  return parents.map((parent) => ({ parent, children: mine.filter((c) => c.parentId === parent.id) }));
}

export type ProgressIndex = Map<string, ProgressRecord>;
export const progressKey = (classSectionId: string, chapterId: string) => `${classSectionId}:${chapterId}`;
export function indexProgress(rows: ProgressRecord[]): ProgressIndex {
  return new Map(rows.map((r) => [progressKey(r.classSectionId, r.chapterId), r]));
}

function leafRow(c: ChapterRecord, p: ProgressRecord | undefined): SyllabusLeaf {
  return {
    id: c.id,
    title: c.title,
    order: c.order,
    status: p?.status ?? 'NOT_STARTED',
    note: p?.note ?? null,
    updatedAt: p ? p.updatedAt.toISOString() : null,
    updatedBy: p?.updatedBy ? fullName(p.updatedBy) : null,
  };
}

/** The chapter rows a teacher or admin sees for one section. */
export function chapterRows(tree: ReturnType<typeof treeOf>, classSectionId: string, progress: ProgressIndex): SyllabusChapterRow[] {
  return tree.map(({ parent, children }) => withDerivedStatus({
    ...leafRow(parent, progress.get(progressKey(classSectionId, parent.id))),
    children: children.map((c) => leafRow(c, progress.get(progressKey(classSectionId, c.id)))),
  }));
}

/** A chapter with sub-topics carries no status of its own: it reads from them. */
export function withDerivedStatus<T extends ChapterNode<LeafState>>(row: T): T {
  return row.children.length ? { ...row, status: chapterStatus(row) } : row;
}

/** The newest progress write on a section's chapters, or null. */
export function lastUpdatedAt(rows: SyllabusChapterRow[]): string | null {
  let last: string | null = null;
  for (const r of rows) for (const l of [r, ...r.children]) if (l.updatedAt && (!last || l.updatedAt > last)) last = l.updatedAt;
  return last;
}
