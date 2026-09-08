import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { FeatureResolverService } from '../../features';
import { isSchemaMissing } from '../../../common/errors/prisma-errors';
import type { HallOfFameEntryDto, HallOfFameGroupDto, HallOfFameSettingsDto } from './cms.dto';
import { readHallOfFameIn, yearsOf, displayNameOf, photoAssetOf, photoAssetIdsOf, DEFAULT_PAST_BATCHES, type HallOfFameRead } from './hall-of-fame.read';

export interface HallOfFameOverview extends Omit<HallOfFameRead, 'entries'> {
  entries: (HallOfFameRead['entries'][number] & {
    /** What the site will print — the linked student's current name when there is one. */
    displayName: string;
    /** Resolved: an explicit upload, else the linked student's profile photo. */
    photoUrl: string | null;
  })[];
  years: number[];
  /** The batch the "New batch" button pre-fills: the current academic year's start year. */
  currentYear: number;
  /** True while the database is behind the deploy (migration not yet applied). */
  unavailable: boolean;
}

export const HOF_MIN_YEAR = 1990;

/** The current academic year's start year, else the calendar year. */
async function currentBatchYear(tx: TenantTx, schoolId: string): Promise<number> {
  const ay = await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { startDate: true } });
  return ay ? ay.startDate.getUTCFullYear() : new Date().getUTCFullYear();
}

@Injectable()
export class HallOfFameService {
  constructor(private readonly features: FeatureResolverService) {}

  async overview(schoolId: string): Promise<HallOfFameOverview> {
    // Two transactions on purpose: a P2021 inside the first would poison the
    // second (Postgres aborts the whole transaction on the first failed statement).
    const currentYear = await withTenant(schoolId, (tx) => currentBatchYear(tx, schoolId));
    try {
      const { read, urls } = await withTenant(schoolId, async (tx) => {
        const r = await readHallOfFameIn(tx, schoolId);
        const ids = photoAssetIdsOf(r);
        const assets = ids.length ? await tx.mediaAsset.findMany({ where: { schoolId, id: { in: ids } }, select: { id: true, url: true } }) : [];
        return { read: r, urls: new Map(assets.map((a) => [a.id, a.url])) };
      });
      return {
        ...read,
        entries: read.entries.map((e) => ({ ...e, displayName: displayNameOf(e), photoUrl: urls.get(photoAssetOf(e) ?? '') ?? null })),
        years: yearsOf(read.entries),
        currentYear,
        unavailable: false,
      };
    } catch (e) {
      if (!isSchemaMissing(e)) throw e;
      return {
        groups: [],
        entries: [],
        settings: { landingYear: null, pastBatches: DEFAULT_PAST_BATCHES },
        years: [],
        currentYear,
        unavailable: true,
      };
    }
  }

  /**
   * Replace the ordered set of groups. Ids the school already owns are
   * updated in place (their podiums survive); ids left out are deleted, and
   * their podiums with them. Every foreign id is checked against the school
   * explicitly — referential integrity bypasses row-level security.
   */
  async setGroups(schoolId: string, groups: HallOfFameGroupDto[]): Promise<HallOfFameOverview> {
    if (groups.some((g) => g.kind === 'GRADES')) {
      const feat = await this.features.getFeatures(schoolId);
      if (!feat.has('MANAGEMENT')) throw new ForbiddenException('Grouping by class needs the Management module');
    }
    const courseIds = [...new Set(groups.flatMap((g) => (g.kind === 'COURSE' && g.courseId ? [g.courseId] : [])))];
    const gradeIds = [...new Set(groups.flatMap((g) => (g.kind === 'GRADES' ? g.gradeIds ?? [] : [])))];
    const sectionIds = [...new Set(groups.flatMap((g) => (g.kind === 'GRADES' ? g.sectionIds ?? [] : [])))];

    await withTenant(schoolId, async (tx) => {
      const [courses, grades, sections, existing] = await Promise.all([
        courseIds.length ? tx.course.findMany({ where: { schoolId, id: { in: courseIds } }, select: { id: true, name: true } }) : [],
        gradeIds.length ? tx.grade.findMany({ where: { schoolId, id: { in: gradeIds } }, select: { id: true, name: true, order: true } }) : [],
        sectionIds.length
          ? tx.classSection.findMany({ where: { schoolId, id: { in: sectionIds } }, select: { id: true, name: true, gradeId: true, grade: { select: { name: true } } } })
          : [],
        tx.hallOfFameGroup.findMany({ where: { schoolId }, select: { id: true } }),
      ]);
      const courseById = new Map(courses.map((c) => [c.id, c]));
      const gradeById = new Map(grades.map((g) => [g.id, g]));
      const sectionById = new Map(sections.map((s) => [s.id, s]));
      const owned = new Set(existing.map((g) => g.id));

      const rows = groups.map((g, i) => {
        const label = (g.label ?? '').trim();
        if (g.kind === 'COURSE') {
          const course = g.courseId ? courseById.get(g.courseId) : undefined;
          if (!course) throw new BadRequestException('Course not found');
          return { kind: g.kind, label: label || course.name, order: i, courseId: course.id, gradeIds: [] as string[], sectionIds: [] as string[] };
        }
        if (g.kind === 'GRADES') {
          const secs = (g.sectionIds ?? []).map((id) => {
            const s = sectionById.get(id);
            if (!s) throw new BadRequestException('Section not found');
            return s;
          });
          const gIds = [...new Set([...(g.gradeIds ?? []), ...secs.map((s) => s.gradeId)])];
          const grs = gIds.map((id) => {
            const gr = gradeById.get(id);
            if (!gr && !secs.some((s) => s.gradeId === id)) throw new BadRequestException('Grade not found');
            return gr ?? null;
          });
          if (gIds.length === 0) throw new BadRequestException('Pick at least one class');
          const auto = secs.length
            ? secs.map((s) => `${s.grade.name}-${s.name}`).join(' · ')
            : grs.map((gr, k) => gr?.name ?? secs.find((s) => s.gradeId === gIds[k])?.grade.name ?? '').filter(Boolean).join(' · ');
          return { kind: g.kind, label: label || auto, order: i, courseId: null, gradeIds: gIds, sectionIds: secs.map((s) => s.id) };
        }
        if (!label) throw new BadRequestException('A custom group needs a name');
        return { kind: g.kind, label, order: i, courseId: null, gradeIds: [] as string[], sectionIds: [] as string[] };
      });

      const keep = groups.map((g) => g.id).filter((id): id is string => !!id && owned.has(id));
      await tx.hallOfFameGroup.deleteMany({ where: { schoolId, id: { notIn: keep } } });
      for (let i = 0; i < rows.length; i++) {
        const id = groups[i].id;
        if (id && owned.has(id)) await tx.hallOfFameGroup.update({ where: { id }, data: rows[i] });
        else await tx.hallOfFameGroup.create({ data: { ...rows[i], schoolId } });
      }
    });
    return this.overview(schoolId);
  }

  /** Replace one group's podium for one batch year. An entry with no name (and no student) clears its place. */
  async setPodium(schoolId: string, groupId: string, batchYear: number, entries: HallOfFameEntryDto[]): Promise<HallOfFameOverview> {
    const currentYear = await withTenant(schoolId, (tx) => currentBatchYear(tx, schoolId));
    if (!Number.isInteger(batchYear) || batchYear < HOF_MIN_YEAR || batchYear > currentYear + 1) {
      throw new BadRequestException(`Batch year must be between ${HOF_MIN_YEAR} and ${currentYear + 1}`);
    }
    const ranks = entries.map((e) => e.rank);
    if (new Set(ranks).size !== ranks.length) throw new BadRequestException('Each place can be filled once');

    await withTenant(schoolId, async (tx) => {
      const group = await tx.hallOfFameGroup.findFirst({ where: { id: groupId, schoolId }, select: { id: true } });
      if (!group) throw new NotFoundException('Group not found');

      const studentIds = [...new Set(entries.flatMap((e) => (e.studentId ? [e.studentId] : [])))];
      const assetIds = [...new Set(entries.flatMap((e) => (e.photoAssetId ? [e.photoAssetId] : [])))];
      const [students, assets] = await Promise.all([
        studentIds.length
          ? tx.student.findMany({ where: { schoolId, id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true } })
          : [],
        assetIds.length ? tx.mediaAsset.findMany({ where: { schoolId, id: { in: assetIds } }, select: { id: true } }) : [],
      ]);
      const studentById = new Map(students.map((s) => [s.id, s]));
      const assetOk = new Set(assets.map((a) => a.id));

      const rows = entries.flatMap((e) => {
        const student = e.studentId ? studentById.get(e.studentId) : undefined;
        if (e.studentId && !student) throw new BadRequestException('Student not found');
        if (e.photoAssetId && !assetOk.has(e.photoAssetId)) throw new BadRequestException('Photo not found');
        const name = (e.name ?? '').trim() || (student ? `${student.firstName} ${student.lastName}`.trim() : '');
        if (!name) return [];
        return [
          {
            schoolId,
            groupId,
            batchYear,
            rank: e.rank,
            name,
            achievement: (e.achievement ?? '').trim() || null,
            // Only an explicit upload is stored; a linked student's profile photo is
            // read live at render time, so what they set in the app is what shows.
            photoAssetId: e.photoAssetId ?? null,
            studentId: student?.id ?? null,
          },
        ];
      });

      await tx.hallOfFameEntry.deleteMany({ where: { schoolId, groupId, batchYear } });
      if (rows.length) await tx.hallOfFameEntry.createMany({ data: rows });
    });
    return this.overview(schoolId);
  }

  async setSettings(schoolId: string, dto: HallOfFameSettingsDto): Promise<HallOfFameOverview> {
    await withTenant(schoolId, (tx) =>
      tx.hallOfFameSettings.upsert({
        where: { schoolId },
        create: { schoolId, landingYear: dto.landingYear ?? null, pastBatches: dto.pastBatches ?? DEFAULT_PAST_BATCHES },
        update: {
          ...(dto.landingYear !== undefined ? { landingYear: dto.landingYear } : {}),
          ...(dto.pastBatches !== undefined ? { pastBatches: dto.pastBatches } : {}),
        },
      }),
    );
    return this.overview(schoolId);
  }
}
