import { ApiError } from '../../common/errors/api-error';
import { resolveAsOfDate } from '../../common/dates/timetable-date';

/**
 * Who may open a syllabus track (one class section + one subject), and who
 * may MARK on it. Three doors, mirroring `requireClassAccess` for the register:
 *
 *   1. the section's class teacher — reads and marks every subject there;
 *   2. a teacher with a live timetable slot for THAT subject in the section —
 *      reads and marks it;
 *   3. today's substitute in the section — reads only. A cover is a one-day
 *      grant and the regular teacher's log is not theirs to move.
 *
 * Anyone else is refused with 403, never an empty page: a wrong section id
 * must not look like "no chapters yet".
 */
export interface SyllabusAccessTx {
  teacher: { findFirst(args: unknown): Promise<{ id: string } | null> };
  classSection: { findFirst(args: unknown): Promise<{ id: string; classTeacherId: string | null; gradeId: string } | null> };
  timetableSlot: { findFirst(args: unknown): Promise<{ id: string } | null> };
  substitution: { findFirst(args: unknown): Promise<{ id: string } | null> };
}

export interface SyllabusAccess {
  teacherId: string;
  gradeId: string;
  isClassTeacher: boolean;
  canEdit: boolean;
}

const liveSlot = (asOf: Date) => ({ effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] });

export async function requireSyllabusAccess(
  tx: SyllabusAccessTx,
  schoolId: string,
  userId: string,
  classSectionId: string,
  subjectId: string,
  today: string,
): Promise<SyllabusAccess> {
  const teacher = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } });
  if (!teacher) throw new ApiError('CLASS_NOT_OWNED', 'Only a teacher can open a class syllabus.', 403);
  const section = await tx.classSection.findFirst({ where: { id: classSectionId, schoolId }, select: { id: true, classTeacherId: true, gradeId: true } });
  if (!section) throw new ApiError('CLASS_NOT_FOUND', 'Class not found.', 404, 'classSectionId');

  const base = { teacherId: teacher.id, gradeId: section.gradeId };
  if (section.classTeacherId === teacher.id) return { ...base, isClassTeacher: true, canEdit: true };

  const asOf = resolveAsOfDate(today, new Date());
  const slot = await tx.timetableSlot.findFirst({ where: { schoolId, classSectionId, subjectId, teacherId: teacher.id, ...liveSlot(asOf) }, select: { id: true } });
  if (slot) return { ...base, isClassTeacher: false, canEdit: true };

  const cover = await tx.substitution.findFirst({ where: { schoolId, classSectionId, date: new Date(today), substituteTeacherId: teacher.id }, select: { id: true } });
  if (cover) return { ...base, isClassTeacher: false, canEdit: false };

  throw new ApiError('SUBJECT_NOT_OWNED', 'You do not teach this subject in this class.', 403, 'subjectId');
}

/**
 * May this teacher edit the chapter list for a grade + subject? Yes when they
 * teach that subject in ANY section of the grade, or are class teacher of one.
 * The list is shared by every section of the grade, so a maths teacher of 9-B
 * adding a chapter is adding it for 9-A as well — by design, and said in the UI.
 */
export async function canEditChapters(
  tx: SyllabusAccessTx,
  schoolId: string,
  userId: string,
  gradeId: string,
  subjectId: string,
  today: string,
): Promise<boolean> {
  const teacher = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } });
  if (!teacher) return false;
  const own = await tx.classSection.findFirst({ where: { schoolId, gradeId, classTeacherId: teacher.id }, select: { id: true, classTeacherId: true, gradeId: true } });
  if (own) return true;
  const asOf = resolveAsOfDate(today, new Date());
  const slot = await tx.timetableSlot.findFirst({ where: { schoolId, subjectId, teacherId: teacher.id, classSection: { gradeId }, ...liveSlot(asOf) }, select: { id: true } });
  return !!slot;
}
