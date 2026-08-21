/** The slice of a tenant transaction this rule needs. Structural, so callers pass their `tx` unchanged. */
export interface ClassAccessTx {
    teacher: {
        findFirst(args: unknown): Promise<{
            id: string;
        } | null>;
    };
    classSection: {
        findFirst(args: unknown): Promise<{
            id: string;
        } | null>;
    };
    substitution: {
        findFirst(args: unknown): Promise<{
            id: string;
        } | null>;
    };
}
/**
 * The slice of a tenant transaction `canReadClassNotes` needs. Widens
 * `substitution.findFirst`'s return over `ClassAccessTx` — the covering-period
 * check needs `periodId` back, not just `id`.
 */
export interface ClassAccessReadTx extends Omit<ClassAccessTx, 'substitution'> {
    substitution: {
        findFirst(args: unknown): Promise<{
            id: string;
            periodId: string;
        } | null>;
    };
    school: {
        findUnique(args: unknown): Promise<{
            classNoteVisibility: string;
        } | null>;
    };
    timetableSlot: {
        findFirst(args: unknown): Promise<{
            id: string;
        } | null>;
    };
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
export declare function requireClassAccess(tx: ClassAccessTx, userId: string, classSectionId: string, date: string, action?: string): Promise<string>;
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
export declare function canReadClassNotes(tx: ClassAccessReadTx, userId: string, role: string, schoolId: string, classSectionId: string, subjectId: string, date: string): Promise<boolean>;
//# sourceMappingURL=class-access.d.ts.map