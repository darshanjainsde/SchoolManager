import { ApiError } from '../../../common/errors/api-error';

/** The slice of a tenant transaction this rule needs. Structural, so callers pass their `tx` unchanged. */
export interface ClassAccessTx {
  teacher: { findFirst(args: unknown): Promise<{ id: string } | null> };
  classSection: { findFirst(args: unknown): Promise<{ id: string } | null> };
  substitution: { findFirst(args: unknown): Promise<{ id: string } | null> };
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

  const owned = await tx.classSection.findFirst({
    where: {
      id: classSectionId,
      OR: [
        { classTeacherId: teacher.id },
        { timetableSlots: { some: { teacherId: teacher.id } } },
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
