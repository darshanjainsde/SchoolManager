import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { PortalService } from './portal.service';
import { RegisterForEventDto, RegisterPushTokenDto, SignDiaryEntryDto } from './portal.dto';
export declare class PortalController {
    private readonly portal;
    constructor(portal: PortalService);
    profile(u: SchoolJwtPayload): Promise<import("@skoolos/types").Profile>;
    timetable(u: SchoolJwtPayload): Promise<import("@skoolos/types").TimetableSlot[]>;
    announcements(u: SchoolJwtPayload): Promise<import("@skoolos/types").Announcement[]>;
    /**
     * `month` is an optional `YYYY-MM`; omitted means the current IST month.
     * Note there is deliberately no student id parameter anywhere on `/me/*` —
     * the row is always resolved from the caller's own JWT `sub`.
     */
    attendance(u: SchoolJwtPayload, month?: string): Promise<import("@skoolos/types").AttendanceSummary>;
    /**
     * The child's own diary (Phase 5·3). `date` narrows to one page; without it,
     * the last month, newest day first. Reading it marks the page seen — that
     * receipt is what the teacher's "23 of 28 families opened this" counts.
     */
    diary(u: SchoolJwtPayload, date?: string): Promise<import("@skoolos/types").StudentDiaryResult>;
    /**
     * Take a place at one of the school's events while signed in.
     *
     * The same engine the public door and the admin desk use, so capacity and the
     * waitlist behave identically — the only difference is that this one knows
     * which pupil is coming, so the desk shows a name it recognises.
     */
    registerForEvent(u: SchoolJwtPayload, id: string, dto: RegisterForEventDto): Promise<{
        id: string;
        status: import("@skoolos/db").$Enums.RegistrationStatus;
        waitlistPos: number | null;
        quantity: number;
    }>;
    /** The signature in the margin of a red-ink remark. */
    signDiary(id: string, dto: SignDiaryEntryDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").DiarySignResult>;
    exams(u: SchoolJwtPayload): Promise<import("@skoolos/types").UpcomingExam[]>;
    results(u: SchoolJwtPayload): Promise<import("@skoolos/types").PublishedResult[]>;
    assignments(u: SchoolJwtPayload): Promise<import("@skoolos/types").StudentAssignmentList>;
    markAssignmentSeen(id: string, u: SchoolJwtPayload): Promise<{
        ok: true;
    }>;
    /**
     * Overrides the class-level `@Roles('STUDENT')` — device registration is
     * for the mobile app generally, which every school role can sign into, not
     * just students. `RolesGuard` uses `getAllAndOverride`, so a method-level
     * `@Roles(...)` here replaces the class-level list rather than adding to it.
     */
    registerPushToken(u: SchoolJwtPayload, dto: RegisterPushTokenDto): Promise<{
        platform: string;
        email: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        token: string;
        userId: string;
        lastSeenAt: Date;
    }>;
    /**
     * Overrides the class-level `@Roles('STUDENT')` — same reasoning as
     * `push-token` above. The school holiday calendar is school-wide, not
     * per-student, so every authenticated role reads the same list.
     */
    holidays(): Promise<import("@skoolos/types").Holiday[]>;
}
//# sourceMappingURL=portal.controller.d.ts.map