import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import type { StudentSyllabusChapter, StudentSyllabusHome, StudentSyllabusLeaf, StudentSyllabusSubject, StudentSyllabusSubjectDetail, SyllabusYear } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { istTodayISO, resolveAsOfDate } from '../../common/dates/timetable-date';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { allLeaves, trackStats } from './syllabus-stats';
import { describeYear, fullName, indexProgress, liveSlotWhere, loadChapters, loadProgress, progressKey, treeOf, withDerivedStatus, type ChapterRecord, type ProgressIndex } from './syllabus-shared';

interface MyStudent {
  id: string;
  classSection: {
    id: string;
    name: string;
    gradeId: string;
    grade: { name: string };
    academicYear: { id: string; name: string; startDate: Date; endDate: Date };
  } | null;
}

/**
 * The syllabus as a child sees it: where the class has reached in each
 * subject, the teacher's note on a chapter, and the child's OWN note — which
 * nobody else reads. The student is always resolved from the login, never
 * from a parameter.
 */
@Injectable()
export class SyllabusPortalService {
  async home(schoolId: string, userId: string): Promise<StudentSyllabusHome> {
    return withTenant(schoolId, async (tx) => {
      const me = await this.myStudent(tx, schoolId, userId);
      if (!me.classSection) return { className: null, year: null, subjects: [] };
      const section = me.classSection;
      const year = await describeYear(tx, schoolId, section.academicYear);
      const chapters = await loadChapters(tx, schoolId, { gradeIds: [section.gradeId] });
      const progress = indexProgress(await loadProgress(tx, schoolId, [section.id]));
      const noted = await this.myNotes(tx, schoolId, me.id);
      const teachers = await this.teacherBySubject(tx, schoolId, section.id);
      const subjectIds = [...new Set(chapters.map((c) => c.subjectId))];
      const names = await this.subjectNames(tx, schoolId, subjectIds);
      const subjects = subjectIds
        .map((subjectId) => this.subjectSummary(subjectId, names.get(subjectId) ?? '', teachers.get(subjectId) ?? null, chapters, section, progress, noted, year))
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
      return { className: `${section.grade.name}-${section.name}`, year, subjects };
    });
  }

  async subject(schoolId: string, userId: string, subjectId: string): Promise<StudentSyllabusSubjectDetail> {
    return withTenant(schoolId, async (tx) => {
      const me = await this.myStudent(tx, schoolId, userId);
      const subject = await tx.subject.findFirst({ where: { id: subjectId, schoolId }, select: { name: true } });
      if (!subject) throw new ApiError('NOT_FOUND', 'Subject not found.', 404, 'subjectId');
      if (!me.classSection) throw new ApiError('NO_CLASS_SECTION', 'You are not in a class yet.', 404);
      const section = me.classSection;
      const year = await describeYear(tx, schoolId, section.academicYear);
      const chapters = await loadChapters(tx, schoolId, { gradeIds: [section.gradeId], subjectIds: [subjectId] });
      const progress = indexProgress(await loadProgress(tx, schoolId, [section.id]));
      const noted = await this.myNotes(tx, schoolId, me.id);
      const teachers = await this.teacherBySubject(tx, schoolId, section.id);
      const summary = this.subjectSummary(subjectId, subject.name, teachers.get(subjectId) ?? null, chapters, section, progress, noted, year);
      const leaf = (c: ChapterRecord): StudentSyllabusLeaf => {
        const p = progress.get(progressKey(section.id, c.id));
        return { id: c.id, title: c.title, order: c.order, status: p?.status ?? 'NOT_STARTED', teacherNote: p?.note ?? null, myNote: noted.get(c.id) ?? null, updatedAt: p ? p.updatedAt.toISOString() : null };
      };
      const rows: StudentSyllabusChapter[] = treeOf(chapters, section.gradeId, subjectId).map(({ parent, children }) => withDerivedStatus({ ...leaf(parent), children: children.map(leaf) }));
      return { subject: summary, year, chapters: rows };
    });
  }

  /** Save, replace or (with an empty body) delete the child's own note on a chapter. */
  async note(schoolId: string, userId: string, chapterId: string, body: string): Promise<{ chapterId: string; myNote: string | null }> {
    return withTenant(schoolId, async (tx) => {
      const me = await this.myStudent(tx, schoolId, userId);
      if (!me.classSection) throw new ApiError('NO_CLASS_SECTION', 'You are not in a class yet.', 404);
      const chapter = await tx.syllabusChapter.findFirst({ where: { id: chapterId, schoolId, gradeId: me.classSection.gradeId, retiredAt: null }, select: { id: true } });
      if (!chapter) throw new ApiError('CHAPTER_NOT_FOUND', 'Chapter not found.', 404, 'chapterId');
      const text = body.trim();
      if (!text) {
        await tx.syllabusStudentNote.deleteMany({ where: { schoolId, studentId: me.id, chapterId } });
        return { chapterId, myNote: null };
      }
      await tx.syllabusStudentNote.upsert({
        where: { studentId_chapterId: { studentId: me.id, chapterId } },
        create: { schoolId, studentId: me.id, chapterId, body: text },
        update: { body: text },
      });
      return { chapterId, myNote: text };
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async myStudent(tx: TenantTx, schoolId: string, userId: string): Promise<MyStudent> {
    const s = await tx.student.findFirst({
      where: { schoolId, userId },
      select: {
        id: true,
        classSection: {
          select: { id: true, name: true, gradeId: true, grade: { select: { name: true } }, academicYear: { select: { id: true, name: true, startDate: true, endDate: true } } },
        },
      },
    });
    if (!s) throw new ApiError('NOT_A_STUDENT', 'No student record for this login.', 404);
    return s;
  }

  private async myNotes(tx: TenantTx, schoolId: string, studentId: string): Promise<Map<string, string>> {
    const rows = await tx.syllabusStudentNote.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, studentId }, select: { chapterId: true, body: true } });
    return new Map(rows.map((r) => [r.chapterId, r.body]));
  }

  private async teacherBySubject(tx: TenantTx, schoolId: string, classSectionId: string): Promise<Map<string, string>> {
    const asOf = resolveAsOfDate(undefined, new Date());
    const slots = await tx.timetableSlot.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, classSectionId, ...liveSlotWhere(asOf) },
      select: { subjectId: true, teacher: { select: { firstName: true, lastName: true } } },
    });
    const out = new Map<string, string>();
    for (const s of slots) if (!out.has(s.subjectId)) out.set(s.subjectId, fullName(s.teacher));
    return out;
  }

  private async subjectNames(tx: TenantTx, schoolId: string, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await tx.subject.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private subjectSummary(
    subjectId: string,
    subjectName: string,
    teacher: string | null,
    chapters: ChapterRecord[],
    section: { id: string; gradeId: string },
    progress: ProgressIndex,
    noted: Map<string, string>,
    year: SyllabusYear,
  ): StudentSyllabusSubject {
    const tree = treeOf(chapters, section.gradeId, subjectId).map(({ parent, children }) => ({
      ...this.leafState(parent, section.id, progress),
      children: children.map((c) => this.leafState(c, section.id, progress)),
    }));
    const stats = trackStats(tree, year.expectedPct);
    const leaves = allLeaves(tree);
    const revised = leaves.filter((l) => noted.has(l.id)).length;
    return {
      subjectId,
      subjectName,
      teacher,
      leaves: stats.leaves,
      done: stats.done,
      teaching: stats.teaching,
      pct: stats.pct,
      revised,
      revisedPct: leaves.length ? Math.round((revised / leaves.length) * 100) : 0,
      now: stats.now,
    };
  }

  private leafState(c: ChapterRecord, classSectionId: string, progress: ProgressIndex) {
    return { id: c.id, title: c.title, status: progress.get(progressKey(classSectionId, c.id))?.status ?? ('NOT_STARTED' as const) };
  }
}

