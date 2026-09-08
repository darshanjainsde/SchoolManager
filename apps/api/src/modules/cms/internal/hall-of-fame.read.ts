import { withTenant, type TenantTx } from '@skoolos/db';
import { isSchemaMissing } from '../../../common/errors/prisma-errors';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

/** The raw Hall of Fame rows a school owns — one shape for the admin overview
 *  and the public projection, so the two can never disagree on a year. */
export interface HallOfFameRead {
  groups: { id: string; kind: 'COURSE' | 'GRADES' | 'CUSTOM'; label: string; order: number; courseId: string | null; gradeIds: string[]; sectionIds: string[] }[];
  entries: {
    id: string;
    groupId: string;
    batchYear: number;
    rank: number;
    name: string;
    achievement: string | null;
    photoAssetId: string | null;
    studentId: string | null;
    /** The linked register row, read live: the profile a student sets in the app wins over what was typed. */
    student: { firstName: string; lastName: string; photoAssetId: string | null } | null;
  }[];
  settings: { landingYear: number | null; pastBatches: number };
}

export const DEFAULT_PAST_BATCHES = 4;

/**
 * Reads in its OWN transaction and answers null when the tables/columns are
 * not there yet (P2021/P2022): the API is deployed before its migration is
 * scheduled, and a failed statement would poison any transaction it shared.
 */
export async function readHallOfFame(schoolId: string): Promise<HallOfFameRead | null> {
  try {
    return await withTenant(schoolId, (tx) => readHallOfFameIn(tx, schoolId));
  } catch (e) {
    if (isSchemaMissing(e)) return null;
    throw e;
  }
}

export async function readHallOfFameIn(tx: TenantTx, schoolId: string): Promise<HallOfFameRead> {
  const [groups, entries, settings] = await Promise.all([
    tx.hallOfFameGroup.findMany({
      take: LIST_CEILING.STRUCTURE,
      where: { schoolId },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
      select: { id: true, kind: true, label: true, order: true, courseId: true, gradeIds: true, sectionIds: true },
    }),
    tx.hallOfFameEntry.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId },
      orderBy: [{ batchYear: 'desc' }, { rank: 'asc' }],
      select: {
        id: true,
        groupId: true,
        batchYear: true,
        rank: true,
        name: true,
        achievement: true,
        photoAssetId: true,
        studentId: true,
        student: { select: { firstName: true, lastName: true, photoAssetId: true } },
      },
    }),
    tx.hallOfFameSettings.findUnique({ where: { schoolId }, select: { landingYear: true, pastBatches: true } }),
  ]);
  return {
    groups,
    entries,
    settings: { landingYear: settings?.landingYear ?? null, pastBatches: settings?.pastBatches ?? DEFAULT_PAST_BATCHES },
  };
}

/** What the site prints: a linked student's current name, else what was typed. */
export function displayNameOf(e: { name: string; student: { firstName: string; lastName: string } | null }): string {
  const live = e.student ? `${e.student.firstName} ${e.student.lastName}`.trim() : '';
  return live || e.name;
}

/** The photo the site shows: an explicit upload on the entry, else the linked student's profile photo. */
export function photoAssetOf(e: { photoAssetId: string | null; student: { photoAssetId: string | null } | null }): string | null {
  return e.photoAssetId ?? e.student?.photoAssetId ?? null;
}

/** Every asset id a read may need resolved to a URL. */
export function photoAssetIdsOf(read: HallOfFameRead | null): string[] {
  return read ? read.entries.map(photoAssetOf).filter((id): id is string => !!id) : [];
}

/** Years that have at least one entry, newest first. */
export function yearsOf(entries: { batchYear: number }[]): number[] {
  return [...new Set(entries.map((e) => e.batchYear))].sort((a, b) => b - a);
}

/** The batch the site lands on: the pinned year when it has entries, else the newest. */
export function landingYearOf(years: number[], pinned: number | null): number | null {
  if (pinned != null && years.includes(pinned)) return pinned;
  return years[0] ?? null;
}

export interface PublicHallOfFameProjection {
  landingYear: number;
  years: number[];
  groups: {
    id: string;
    label: string;
    courseId: string | null;
    entries: { batchYear: number; rank: number; name: string; achievement: string | null; photoUrl: string | null }[];
  }[];
}

/**
 * What the public site receives: the `pastBatches` newest years (the landing
 * year always among them), and only groups that have a podium in that window.
 * null when there is nothing to show.
 */
export function projectHallOfFame(
  read: HallOfFameRead | null,
  urlOf: (id: string | null | undefined) => string | null,
): PublicHallOfFameProjection | null {
  if (!read || read.entries.length === 0) return null;
  const years = yearsOf(read.entries);
  const landing = landingYearOf(years, read.settings.landingYear);
  if (landing == null) return null;
  const n = Math.max(1, read.settings.pastBatches);
  let shown = years.slice(0, n);
  if (!shown.includes(landing)) shown = [...shown.slice(0, n - 1), landing];
  shown.sort((a, b) => b - a);
  const inWindow = new Set(shown);
  const groups = read.groups
    .map((g) => ({
      id: g.id,
      label: g.label,
      courseId: g.courseId,
      entries: read.entries
        .filter((e) => e.groupId === g.id && inWindow.has(e.batchYear))
        .sort((a, b) => b.batchYear - a.batchYear || a.rank - b.rank)
        .map((e) => ({ batchYear: e.batchYear, rank: e.rank, name: displayNameOf(e), achievement: e.achievement, photoUrl: urlOf(photoAssetOf(e)) })),
    }))
    .filter((g) => g.entries.length > 0);
  if (groups.length === 0) return null;
  return { landingYear: landing, years: shown, groups };
}
