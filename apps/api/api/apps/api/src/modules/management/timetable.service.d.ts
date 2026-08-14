import type { TimetableSlot } from '@skoolos/types';
import type { AssignSlotDto, AvailabilityQueryDto } from './management.dto';
export type { TimetableSlot };
export declare class TimetableService {
    /**
     * The slot versions ACTIVE on `date` (default: today) for `classSectionId`
     * — i.e. `effectiveFrom <= date AND (effectiveTo IS NULL OR effectiveTo > date)`.
     * Reading a past `date` returns whatever version was active back then, even
     * if it has since been superseded — that's what makes past weeks immutable.
     */
    listForClass(schoolId: string, classSectionId: string, date?: string): Promise<TimetableSlot[]>;
    /**
     * Versioned assign: never mutates an existing slot's teacher/subject in
     * place. For the target (classSectionId, dayOfWeek, periodId, academicYearId):
     *  - no ACTIVE version (effectiveTo IS NULL) → create one, effectiveFrom = today.
     *  - an ACTIVE version exists and differs → close it (effectiveTo = today)
     *    and create a new ACTIVE version (effectiveFrom = today). The old row
     *    is kept forever, so a past `date` read still sees it.
     *  - an ACTIVE version exists, was itself first created today, and differs
     *    → update it in place instead of stacking two versions on the same
     *    calendar day (versioning is day-granular; there is no "past" instant
     *    to preserve within the same day, and the effectiveFrom unique index
     *    would otherwise collide).
     *  - an ACTIVE version exists and matches exactly (same subject + teacher)
     *    → no-op, return it as-is.
     * Teacher-clash detection is unchanged in spirit: a teacher can't hold two
     * ACTIVE slots in the same day+period, excluding the very slot being
     * replaced.
     */
    assign(schoolId: string, dto: AssignSlotDto): Promise<{
        subject: {
            code: string;
            name: string;
            id: string;
        };
        classSection: {
            name: string;
            id: string;
            grade: {
                name: string;
            };
        };
        teacher: {
            id: string;
            firstName: string;
            lastName: string;
        };
        period: {
            kind: import("@skoolos/db").$Enums.PeriodKind;
            id: string;
            schoolId: string;
            order: number;
            label: string;
            startTime: string;
            endTime: string;
        };
    } & {
        id: string;
        schoolId: string;
        classSectionId: string;
        academicYearId: string;
        subjectId: string;
        periodId: string;
        dayOfWeek: number;
        teacherId: string;
        effectiveFrom: Date;
        effectiveTo: Date | null;
    }>;
    /**
     * `kind` and the clock times are part of the availability payload, not just
     * the timetable's.
     *
     * The availability grid has to draw a BREAK as a gap rather than as a period
     * where the whole staff is conveniently free, and it has to open on the
     * period that is actually running — an admin looking for cover almost always
     * wants the current hour or the next one. Both facts live here; without them
     * the client is left inferring a break from whether the label happens to
     * contain the word "lunch", which is a guess that breaks on the first school
     * that calls it "Recess".
     */
    private static readonly PERIOD_FIELDS;
    availability(schoolId: string, query: AvailabilityQueryDto): Promise<{
        teachers: {
            id: string;
            firstName: string;
            lastName: string;
        }[];
        periods: {
            kind: import("@skoolos/db").$Enums.PeriodKind;
            id: string;
            order: number;
            label: string;
            startTime: string;
            endTime: string;
        }[];
        busy: {
            periodId: string;
            dayOfWeek: number;
            teacherId: string;
        }[];
    }>;
    /**
     * The caller's own active slots for the whole week, as of `date`
     * (default today). Same effectiveFrom/effectiveTo versioning as
     * `listForClass`, so a past date returns the timetable as it stood then.
     */
    listForTeacher(schoolId: string, userId: string, date?: string): Promise<TimetableSlot[]>;
    /** Closes the active version (`effectiveTo = today`) rather than deleting — history is preserved. */
    unassign(schoolId: string, id: string): Promise<void>;
}
//# sourceMappingURL=timetable.service.d.ts.map