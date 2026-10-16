import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import type { SyllabusChapterList, SyllabusOverview, SyllabusTrack, SyllabusTrackSummary, SyllabusYear } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { istTodayISO, resolveAsOfDate } from '../../common/dates/timetable-date';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import type { UserRole } from '@skoolos/db';
import { canEditChapters, requireSyllabusAccess } from './syllabus-access';
import { reachPlan, trackStats } from './syllabus-stats';
import { chapterRows, currentYear, describeYear, fullName, indexProgress, lastUpdatedAt, liveSlotWhere, loadChapters, loadProgress, treeOf, type ChapterRecord, type ProgressIndex } from './syllabus-shared';
import type { CreateChapterDto, MarkProgressDto, UpdateChapterDto } from './syllabus.dto';

interface SectionRecord {
  id: string;
  name: string;
  gradeId: string;
  classTeacherId: string | null;
  grade: { name: string; order: number };
}

interface SlotRecord {
  classSectionId: string;
  subjectId: string;
  teacherId: string;
  teacher: { firstName: string; lastName: string };
}

interface Caller {
  userId: string;
  role: UserRole;
}

/**
 * The syllabus tracker for teachers (mark what the class has reached) and
 * the admin console (see every section against the year).
 *
 * Chapters belong to Grade + Subject and are shared by every section of the
 * grade, this year and next; progress belongs to the year-bound section. So
 * "new session" is not an event here: next year's sections simply have no
 * progress rows yet.
 */
@Injectable()
export class SyllabusService {
  // ── Teacher: my tracks ────────────────────────────────────────────────────

  async mine(schoolId: string, userId: string): Promise<{ year: SyllabusYear | null; tracks: SyllabusTrackSummary[] }> {
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } });
      const year = await currentYear(tx, schoolId);
      if (!teacher || !year) return { year: null, tracks: [] };
      const described = await describeYear(tx, schoolId, year);
      const asOf = resolveAsOfDate(undefined, new Date());

      const ownSections = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: year.id, classTeacherId: teacher.id },
        select: { id: true, name: true, gradeId: true, classTeacherId: true, grade: { select: { name: true, order: true } } },
      });
      const slots: SlotRecord[] = await tx.timetableSlot.findMany({
        take: LIST_CEILING.ROSTER,
        where: {
          schoolId,
          academicYearId: year.id,
          ...liveSlotWhere(asOf),
          OR: [{ teacherId: teacher.id }, { classSectionId: { in: ownSections.map((s) => s.id) } }],
        },
        select: { classSectionId: true, subjectId: true, teacherId: true, teacher: { select: { firstName: true, lastName: true } } },
      });
      // Sections reached only through a slot (not as class teacher) still need their names.
      const slotSectionIds = [...new Set(slots.map((s) => s.classSectionId))].filter((id) => !ownSections.some((s) => s.id === id));
      const slotSections: SectionRecord[] = slotSectionIds.length
        ? await tx.classSection.findMany({
            take: LIST_CEILING.STRUCTURE,
            where: { schoolId, id: { in: slotSectionIds } },
            select: { id: true, name: true, gradeId: true, classTeacherId: true, grade: { select: { name: true, order: true } } },
          })
        : [];
      const sections = [...ownSections, ...slotSections];
      const chapters = await loadChapters(tx, schoolId, { gradeIds: [...new Set(sections.map((s) => s.gradeId))] });

      // Pairs: my own slots, plus every subject taught (or planned) in a section I hold.
      const pairs = new Map<string, { section: SectionRecord; subjectId: string }>();
      const add = (section: SectionRecord | undefined, subjectId: string) => {
        if (section) pairs.set(`${section.id}:${subjectId}`, { section, subjectId });
      };
      for (const s of slots) add(sections.find((x) => x.id === s.classSectionId), s.subjectId);
      for (const s of ownSections) for (const c of chapters) if (c.gradeId === s.gradeId) add(s, c.subjectId);

      const progress = indexProgress(await loadProgress(tx, schoolId, sections.map((s) => s.id)));
      const subjects = await this.subjectNames(tx, schoolId, [...new Set([...pairs.values()].map((p) => p.subjectId))]);
      const tracks = [...pairs.values()].map(({ section, subjectId }) =>
        this.summary(section, subjectId, subjects.get(subjectId) ?? '', chapters, progress, described, slots, teacher.id),
      );
      // The subjects I teach myself first; the rest of my own section (as its
      // class teacher) after — a class teacher of V-C holds eight subjects there
      // and should not hunt for their own English among them.
      const own = new Set(slots.filter((s) => s.teacherId === teacher.id).map((s) => `${s.classSectionId}:${s.subjectId}`));
      const mine = sortTracks(tracks.filter((t) => own.has(`${t.classSectionId}:${t.subjectId}`)));
      const rest = sortTracks(tracks.filter((t) => !own.has(`${t.classSectionId}:${t.subjectId}`)));
      return { year: described, tracks: [...mine, ...rest] };
    });
  }

  // ── Admin: the overview ───────────────────────────────────────────────────

  async overview(schoolId: string): Promise<SyllabusOverview> {
    return withTenant(schoolId, async (tx) => {
      const year = await currentYear(tx, schoolId);
      if (!year) return { year: null, tracks: [], grades: [], sections: [], subjects: [], teachers: [] };
      const described = await describeYear(tx, schoolId, year);
      const asOf = resolveAsOfDate(undefined, new Date());

      const sections: SectionRecord[] = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: year.id },
        select: { id: true, name: true, gradeId: true, classTeacherId: true, grade: { select: { name: true, order: true } } },
      });
      const slots: SlotRecord[] = await tx.timetableSlot.findMany({
        take: LIST_CEILING.ROSTER,
        where: { schoolId, academicYearId: year.id, ...liveSlotWhere(asOf) },
        select: { classSectionId: true, subjectId: true, teacherId: true, teacher: { select: { firstName: true, lastName: true } } },
      });
      const chapters = await loadChapters(tx, schoolId);
      const progress = indexProgress(await loadProgress(tx, schoolId, sections.map((s) => s.id)));

      const pairs = new Map<string, { section: SectionRecord; subjectId: string }>();
      for (const s of slots) {
        const section = sections.find((x) => x.id === s.classSectionId);
        if (section) pairs.set(`${section.id}:${s.subjectId}`, { section, subjectId: s.subjectId });
      }
      for (const section of sections) for (const c of chapters) if (c.gradeId === section.gradeId) pairs.set(`${section.id}:${c.subjectId}`, { section, subjectId: c.subjectId });

      const subjects = await this.subjectNames(tx, schoolId, [...new Set([...pairs.values()].map((p) => p.subjectId))]);
      const tracks = sortTracks(
        [...pairs.values()].map(({ section, subjectId }) => this.summary(section, subjectId, subjects.get(subjectId) ?? '', chapters, progress, described, slots)),
      );
      const grades = [...new Map(sections.map((s) => [s.gradeId, { id: s.gradeId, name: s.grade.name, order: s.grade.order }])).values()].sort((a, b) => a.order - b.order);
      const teachers = [...new Map(slots.map((s) => [s.teacherId, { id: s.teacherId, name: fullName(s.teacher) }])).values()].sort((a, b) => a.name.localeCompare(b.name));
      return {
        year: described,
        tracks,
        grades,
        sections: sections
          .slice()
          .sort((a, b) => a.grade.order - b.grade.order || a.name.localeCompare(b.name))
          .map((s) => ({ id: s.id, gradeId: s.gradeId, name: s.name, label: `${s.grade.name}-${s.name}` })),
        subjects: [...subjects.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        teachers,
      };
    });
  }

  // ── One track ─────────────────────────────────────────────────────────────

  async track(schoolId: string, caller: Caller, classSectionId: string, subjectId: string): Promise<SyllabusTrack> {
    return withTenant(schoolId, (tx) => this.trackIn(tx, schoolId, caller, classSectionId, subjectId));
  }

  private async trackIn(tx: TenantTx, schoolId: string, caller: Caller, classSectionId: string, subjectId: string): Promise<SyllabusTrack> {
    const today = istTodayISO();
    const access = caller.role === 'SCHOOL_ADMIN' ? null : await requireSyllabusAccess(tx, schoolId, caller.userId, classSectionId, subjectId, today);
    const section = await tx.classSection.findFirst({
      where: { id: classSectionId, schoolId },
      select: {
        id: true,
        name: true,
        gradeId: true,
        classTeacherId: true,
        grade: { select: { name: true, order: true } },
        academicYear: { select: { id: true, name: true, startDate: true, endDate: true } },
      },
    });
    if (!section) throw new ApiError('CLASS_NOT_FOUND', 'Class not found.', 404, 'classSectionId');
    const subject = await tx.subject.findFirst({ where: { id: subjectId, schoolId }, select: { name: true } });
    if (!subject) throw new ApiError('NOT_FOUND', 'Subject not found.', 404, 'subjectId');

    const year = await describeYear(tx, schoolId, section.academicYear, today);
    const asOf = resolveAsOfDate(today, new Date());
    const slots: SlotRecord[] = await tx.timetableSlot.findMany({
      take: LIST_CEILING.STRUCTURE,
      where: { schoolId, classSectionId, subjectId, ...liveSlotWhere(asOf) },
      select: { classSectionId: true, subjectId: true, teacherId: true, teacher: { select: { firstName: true, lastName: true } } },
    });
    const chapters = await loadChapters(tx, schoolId, { gradeIds: [section.gradeId], subjectIds: [subjectId] });
    const progress = indexProgress(await loadProgress(tx, schoolId, [classSectionId]));
    const summary = this.summary(section, subjectId, subject.name, chapters, progress, year, slots, access?.teacherId);
    return { summary, year, canEdit: access?.canEdit ?? false, chapters: chapterRows(treeOf(chapters, section.gradeId, subjectId), classSectionId, progress) };
  }

  // ── Marking ───────────────────────────────────────────────────────────────

  async mark(schoolId: string, caller: Caller, classSectionId: string, subjectId: string, chapterId: string, dto: MarkProgressDto): Promise<SyllabusTrack> {
    return withTenant(schoolId, async (tx) => {
      const access = await this.requireMarker(tx, schoolId, caller, classSectionId, subjectId);
      const chapter = await this.liveChapter(tx, schoolId, chapterId, access.gradeId, subjectId);
      if (dto.status !== undefined) {
        const children = await tx.syllabusChapter.findFirst({ where: { schoolId, parentId: chapter.id, retiredAt: null }, select: { id: true } });
        if (children) throw new ApiError('VALIDATION', 'Mark the sub-topics; the chapter follows them.', 400, 'status');
      }
      const note = dto.note === undefined ? undefined : dto.note.trim() || null;
      await tx.syllabusProgress.upsert({
        where: { classSectionId_chapterId: { classSectionId, chapterId } },
        create: { schoolId, classSectionId, chapterId, status: dto.status ?? 'NOT_STARTED', note: note ?? null, updatedById: access.teacherId },
        update: { ...(dto.status !== undefined ? { status: dto.status } : {}), ...(note !== undefined ? { note } : {}), updatedById: access.teacherId },
      });
      return this.trackIn(tx, schoolId, caller, classSectionId, subjectId);
    });
  }

  /** "Reached here": everything before this leaf is done, this one is being taught. */
  async reach(schoolId: string, caller: Caller, classSectionId: string, subjectId: string, chapterId: string): Promise<SyllabusTrack> {
    return withTenant(schoolId, async (tx) => {
      const access = await this.requireMarker(tx, schoolId, caller, classSectionId, subjectId);
      const chapters = await loadChapters(tx, schoolId, { gradeIds: [access.gradeId], subjectIds: [subjectId] });
      const tree = treeOf(chapters, access.gradeId, subjectId).map(({ parent, children }) => ({
        ...asLeaf(parent),
        children: children.map(asLeaf),
      }));
      if (!chapters.some((c) => c.id === chapterId)) throw new ApiError('CHAPTER_NOT_FOUND', 'Chapter not found.', 404, 'chapterId');
      const plan = reachPlan(tree, chapterId);
      if (!plan) throw new ApiError('VALIDATION', 'Reach a sub-topic; the chapter follows them.', 400, 'chapterId');

      const touched = [...plan.before, plan.target];
      await tx.syllabusProgress.createMany({
        data: touched.map((id) => ({ schoolId, classSectionId, chapterId: id, updatedById: access.teacherId })),
        skipDuplicates: true,
      });
      if (plan.before.length) {
        await tx.syllabusProgress.updateMany({
          where: { schoolId, classSectionId, chapterId: { in: plan.before }, status: { not: 'DONE' } },
          data: { status: 'DONE', updatedById: access.teacherId },
        });
      }
      await tx.syllabusProgress.updateMany({
        where: { schoolId, classSectionId, chapterId: plan.target },
        data: { status: 'TEACHING', updatedById: access.teacherId },
      });
      return this.trackIn(tx, schoolId, caller, classSectionId, subjectId);
    });
  }

  // ── Chapter lists ─────────────────────────────────────────────────────────

  async chapters(schoolId: string, caller: Caller, gradeId: string, subjectId: string): Promise<SyllabusChapterList> {
    return withTenant(schoolId, async (tx) => {
      const grade = await tx.grade.findFirst({ where: { id: gradeId, schoolId }, select: { name: true } });
      if (!grade) throw new ApiError('NOT_FOUND', 'Class not found.', 404, 'gradeId');
      const subject = await tx.subject.findFirst({ where: { id: subjectId, schoolId }, select: { name: true } });
      if (!subject) throw new ApiError('NOT_FOUND', 'Subject not found.', 404, 'subjectId');
      const canEdit = await this.mayEditChapters(tx, schoolId, caller, gradeId, subjectId);
      const chapters = await loadChapters(tx, schoolId, { gradeIds: [gradeId], subjectIds: [subjectId] });
      return {
        gradeId,
        gradeName: grade.name,
        subjectId,
        subjectName: subject.name,
        canEdit,
        chapters: treeOf(chapters, gradeId, subjectId).map(({ parent, children }) => ({
          id: parent.id,
          title: parent.title,
          order: parent.order,
          children: children.map((c) => ({ id: c.id, title: c.title, order: c.order })),
        })),
      };
    });
  }

  async createChapter(schoolId: string, caller: Caller, dto: CreateChapterDto): Promise<{ id: string }> {
    return withTenant(schoolId, async (tx) => {
      const grade = await tx.grade.findFirst({ where: { id: dto.gradeId, schoolId }, select: { id: true } });
      if (!grade) throw new ApiError('NOT_FOUND', 'Class not found.', 404, 'gradeId');
      const subject = await tx.subject.findFirst({ where: { id: dto.subjectId, schoolId }, select: { id: true } });
      if (!subject) throw new ApiError('NOT_FOUND', 'Subject not found.', 404, 'subjectId');
      await this.requireChapterEditor(tx, schoolId, caller, dto.gradeId, dto.subjectId);
      if (dto.parentId) {
        const parent = await tx.syllabusChapter.findFirst({
          where: { id: dto.parentId, schoolId, gradeId: dto.gradeId, subjectId: dto.subjectId, retiredAt: null },
          select: { parentId: true },
        });
        if (!parent) throw new ApiError('CHAPTER_NOT_FOUND', 'Chapter not found.', 404, 'parentId');
        if (parent.parentId) throw new ApiError('VALIDATION', 'A sub-topic cannot have sub-topics of its own.', 400, 'parentId');
      }
      const last = await tx.syllabusChapter.findFirst({
        where: { schoolId, gradeId: dto.gradeId, subjectId: dto.subjectId, parentId: dto.parentId ?? null },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      const row = await tx.syllabusChapter.create({
        data: { schoolId, gradeId: dto.gradeId, subjectId: dto.subjectId, parentId: dto.parentId ?? null, title: dto.title.trim(), order: (last?.order ?? -1) + 1 },
        select: { id: true },
      });
      return { id: row.id };
    });
  }

  async updateChapter(schoolId: string, caller: Caller, id: string, dto: UpdateChapterDto): Promise<{ id: string }> {
    return withTenant(schoolId, async (tx) => {
      const chapter = await tx.syllabusChapter.findFirst({ where: { id, schoolId, retiredAt: null }, select: { gradeId: true, subjectId: true } });
      if (!chapter) throw new ApiError('CHAPTER_NOT_FOUND', 'Chapter not found.', 404);
      await this.requireChapterEditor(tx, schoolId, caller, chapter.gradeId, chapter.subjectId);
      await tx.syllabusChapter.update({
        where: { id },
        data: { ...(dto.title !== undefined ? { title: dto.title.trim() } : {}), ...(dto.order !== undefined ? { order: dto.order } : {}) },
        select: { id: true },
      });
      return { id };
    });
  }

  /** Retire, never delete: progress and student notes keep their rows. Sub-topics go with the chapter. */
  async retireChapter(schoolId: string, caller: Caller, id: string): Promise<void> {
    return withTenant(schoolId, async (tx) => {
      const chapter = await tx.syllabusChapter.findFirst({ where: { id, schoolId, retiredAt: null }, select: { gradeId: true, subjectId: true } });
      if (!chapter) throw new ApiError('CHAPTER_NOT_FOUND', 'Chapter not found.', 404);
      await this.requireChapterEditor(tx, schoolId, caller, chapter.gradeId, chapter.subjectId);
      const now = new Date();
      await tx.syllabusChapter.updateMany({ where: { schoolId, OR: [{ id }, { parentId: id }], retiredAt: null }, data: { retiredAt: now } });
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async requireMarker(tx: TenantTx, schoolId: string, caller: Caller, classSectionId: string, subjectId: string) {
    if (caller.role !== 'TEACHER') throw new ApiError('CLASS_NOT_OWNED', 'Only the class or subject teacher marks the syllabus.', 403);
    const access = await requireSyllabusAccess(tx, schoolId, caller.userId, classSectionId, subjectId, istTodayISO());
    if (!access.canEdit) throw new ApiError('CLASS_NOT_OWNED', 'A substitute can read the syllabus but not mark it.', 403);
    return access;
  }

  private async liveChapter(tx: TenantTx, schoolId: string, id: string, gradeId: string, subjectId: string): Promise<ChapterRecord> {
    const chapter = await tx.syllabusChapter.findFirst({
      where: { id, schoolId, gradeId, subjectId, retiredAt: null },
      select: { id: true, gradeId: true, subjectId: true, parentId: true, title: true, order: true, createdAt: true },
    });
    if (!chapter) throw new ApiError('CHAPTER_NOT_FOUND', 'Chapter not found.', 404, 'chapterId');
    return chapter;
  }

  private async mayEditChapters(tx: TenantTx, schoolId: string, caller: Caller, gradeId: string, subjectId: string): Promise<boolean> {
    if (caller.role === 'SCHOOL_ADMIN') return true;
    if (caller.role !== 'TEACHER') return false;
    return canEditChapters(tx, schoolId, caller.userId, gradeId, subjectId, istTodayISO());
  }

  private async requireChapterEditor(tx: TenantTx, schoolId: string, caller: Caller, gradeId: string, subjectId: string): Promise<void> {
    if (!(await this.mayEditChapters(tx, schoolId, caller, gradeId, subjectId))) {
      throw new ApiError('SUBJECT_NOT_OWNED', 'Only the admin or a teacher of this subject edits its chapters.', 403);
    }
  }

  private async subjectNames(tx: TenantTx, schoolId: string, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await tx.subject.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private summary(
    section: SectionRecord,
    subjectId: string,
    subjectName: string,
    chapters: ChapterRecord[],
    progress: ProgressIndex,
    year: SyllabusYear,
    slots: SlotRecord[],
    callerTeacherId?: string,
  ): SyllabusTrackSummary {
    const rows = chapterRows(treeOf(chapters, section.gradeId, subjectId), section.id, progress);
    const stats = trackStats(rows, year.expectedPct);
    const slot = mostSlots(slots.filter((s) => s.classSectionId === section.id && s.subjectId === subjectId));
    return {
      classSectionId: section.id,
      className: `${section.grade.name}-${section.name}`,
      gradeId: section.gradeId,
      gradeName: section.grade.name,
      gradeOrder: section.grade.order,
      sectionName: section.name,
      subjectId,
      subjectName,
      teacher: slot ? { id: slot.teacherId, name: fullName(slot.teacher) } : null,
      ...(callerTeacherId ? { isClassTeacher: section.classTeacherId === callerTeacherId } : {}),
      ...stats,
      expectedPct: year.expectedPct,
      lastUpdatedAt: lastUpdatedAt(rows),
    };
  }
}

const asLeaf = (c: ChapterRecord) => ({ id: c.id, title: c.title, status: 'NOT_STARTED' as const });

/** The teacher who holds most periods of the pair; ties go to the first slot. */
function mostSlots(slots: SlotRecord[]): SlotRecord | null {
  const count = new Map<string, number>();
  for (const s of slots) count.set(s.teacherId, (count.get(s.teacherId) ?? 0) + 1);
  let best: SlotRecord | null = null;
  for (const s of slots) if (!best || (count.get(s.teacherId) ?? 0) > (count.get(best.teacherId) ?? 0)) best = s;
  return best;
}

function sortTracks(tracks: SyllabusTrackSummary[]): SyllabusTrackSummary[] {
  return tracks.sort((a, b) => a.gradeOrder - b.gradeOrder || a.sectionName.localeCompare(b.sectionName) || a.subjectName.localeCompare(b.subjectName));
}

