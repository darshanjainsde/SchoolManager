import { ApiError } from '../../../common/errors/api-error';
import { resolveAsOfDate } from './timetable-date';

/** The slice of a tenant transaction this rule needs. Structural, so callers pass their `tx` unchanged. */
export interface ClassAccessTx {
  teacher: { findFirst(args: unknown): Promise<{ id: string } | null> };
  classSection: { findFirst(args: unknown): Promise<{ id: string } | null> };
  substitution: { findFirst(args: unknown): Promise<{ id: string } | null> };
}

/**
 * The slice of a tenant transaction `canReadClassNotes` needs. Widens
 * `substitution.findFirst`'s return over `ClassAccessTx` — the covering-period
 * check needs `periodId` back, not just `id`.
 */
export interface ClassAccessReadTx extends Omit<ClassAccessTx, 'substitution'> {
  substitution: { findFirst(args: unknown): Promise<{ id: string; periodId: string } | null> };
  school: { findUnique(args: unknown): Promise<{ classNoteVisibility: string } | null> };
  timetableSlot: { findFirst(args: unknown): Promise<{ id: string } | null> };
}

/**
 * Resolves `userId` to a Teacher and asserts they may act on `classSectionId`
 * on `date`. "May act" means one of three things, and nothing else:
 *
 *   1. they are the section's class teacher,
 *   2. they hold at least one timetable slot in it, or
 *   3. they are the named substitute for one of its periods on that date.
 *
 * Case 3 is a ONE-DAY grant: a substitution never widens access to any other
 * date, which is why `date` is part of the question rather than ambient.
 *
 * Returns the caller's `Teacher.id` so callers can attribute the write.
 * Throws `ApiError('CLASS_NOT_OWNED', ..., 403)` otherwise — never returns a
 * boolean, so a caller cannot forget to branch on it.
 */
export async function requireClassAccess(
  tx: ClassAccessTx,
  userId: string,
  classSectionId: string,
  date: string,
  action = 'take attendance for',
): Promise<string> {
  const teacher = await tx.teacher.findFirst({ where: { userId } });
  if (!teacher) {
    throw new ApiError('CLASS_NOT_OWNED', `Only a teacher can ${action} a class.`, 403);
  }

  const asOf = resolveAsOfDate(date, new Date());
  const owned = await tx.classSection.findFirst({
    where: {
      id: classSectionId,
      OR: [
        { classTeacherId: teacher.id },
        {
          timetableSlots: {
            some: {
              teacherId: teacher.id,
              effectiveFrom: { lte: asOf },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (owned) return teacher.id;

  const covering = await tx.substitution.findFirst({
    where: { classSectionId, date: new Date(date), substituteTeacherId: teacher.id },
    select: { id: true },
  });
  if (covering) return teacher.id;

  throw new ApiError(
    'CLASS_NOT_OWNED',
    `You can only ${action} your own classes.`,
    403,
    'classSectionId',
  );
}

/**
 * Whether `userId` may READ notes for (classSectionId, subjectId) on `date`.
 *
 * Under `ALL_TEACHERS` this is just class access — see `requireClassAccess`.
 * Under `SUBJECT_TEACHERS` it is one of three things, in the order they are
 * cheapest to check:
 *   1. they are the section's class teacher — always, regardless of subject,
 *      because the class teacher owns the whole child;
 *   2. they hold a timetable slot for that section AND that subject;
 *   3. they are the named substitute for that section on that date, covering a
 *      period whose slot teaches that subject.
 *
 * `SCHOOL_ADMIN` bypasses entirely. Returns a boolean rather than throwing —
 * the list endpoint needs to filter, not fail.
 *
 * The visibility setting is read from `School` on every call — deliberately
 * not cached anywhere in module scope, so a school toggling the setting is
 * reflected on the very next request.
 */
export async function canReadClassNotes(
  tx: ClassAccessReadTx,
  userId: string,
  role: string,
  schoolId: string,
  classSectionId: string,
  subjectId: string,
  date: string,
): Promise<boolean> {
  if (role === 'SCHOOL_ADMIN') return true;

  const teacher = await tx.teacher.findFirst({ where: { userId } });
  if (!teacher) return false;

  const school = await tx.school.findUnique({
    where: { id: schoolId },
    select: { classNoteVisibility: true },
  });
  const visibility = school?.classNoteVisibility ?? 'ALL_TEACHERS';
  const asOf = resolveAsOfDate(date, new Date());

  if (visibility === 'ALL_TEACHERS') {
    const owned = await tx.classSection.findFirst({
      where: {
        id: classSectionId,
        OR: [
          { classTeacherId: teacher.id },
          {
            timetableSlots: {
              some: {
                teacherId: teacher.id,
                effectiveFrom: { lte: asOf },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (owned) return true;

    const covering = await tx.substitution.findFirst({
      where: { classSectionId, date: new Date(date), substituteTeacherId: teacher.id },
      select: { id: true },
    });
    return !!covering;
  }

  // SUBJECT_TEACHERS from here.

  // 1. The class teacher sees every subject for their own section.
  const asClassTeacher = await tx.classSection.findFirst({
    where: { id: classSectionId, classTeacherId: teacher.id },
    select: { id: true },
  });
  if (asClassTeacher) return true;

  // 2. Holds a live timetable slot for exactly this section+subject.
  const slot = await tx.timetableSlot.findFirst({
    where: {
      classSectionId,
      subjectId,
      teacherId: teacher.id,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
    },
    select: { id: true },
  });
  if (slot) return true;

  // 3. Substituting for this section on this exact date, in a period whose
  // slot teaches this subject. A one-day grant, same as write access.
  const covering = await tx.substitution.findFirst({
    where: { classSectionId, date: new Date(date), substituteTeacherId: teacher.id },
    select: { periodId: true },
  });
  if (!covering) return false;

  const coveredSlot = await tx.timetableSlot.findFirst({
    where: {
      classSectionId,
      periodId: covering.periodId,
      subjectId,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
    },
    select: { id: true },
  });
  return !!coveredSlot;
}
