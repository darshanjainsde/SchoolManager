import type { RosterStudent } from '@skoolos/types';
import { PasswordService } from '../auth';
import { LoginInviteService } from './internal/login-invite.service';
import type { CreateLoginDto, CreateStudentDto, UpdateStudentDto } from './management.dto';
export interface LoginInviteResult {
    email: string;
    username: string | null;
    loginName: string;
    invited: true;
    emailSent: boolean;
}
/** RAF-00042 — 3 letters + a zero-padded counter (5 digits, growing past
 *  99999). This is THE canonical shape: when the 2026-08-07 seed shipped
 *  4-digit codes and locked students out of the gate, the decision was to
 *  migrate the DATA to this format (RPS-0021 → RPS-00021), never to widen
 *  the validators. Fixtures must round-trip this regex. */
export declare const STUDENT_CODE_REGEX: RegExp;
/**
 * How much of a Student row the caller is allowed to see.
 *
 * - `full`   — every column plus the class/grade names. SCHOOL_ADMIN only.
 * - `roster` — the four fields needed to render a name next to a studentId
 *              (attendance / exam-result entry). Deliberately excludes the
 *              minor's PII: guardianName, guardianPhone, dob, gender,
 *              admissionNo, userId.
 *
 * The caller (controller) decides which projection applies — this service
 * never reads the request/role itself.
 */
export type StudentProjection = 'full' | 'roster';
/** Exactly the columns a `roster` projection may return. */
export declare const ROSTER_SELECT: {
    readonly id: true;
    readonly firstName: true;
    readonly lastName: true;
    readonly rollNo: true;
};
export type { RosterStudent };
interface ListFilters {
    classSectionId?: string;
    projection?: StudentProjection;
}
export declare class StudentsService {
    private readonly passwords;
    private readonly invites;
    constructor(passwords: PasswordService, invites: LoginInviteService);
    list(schoolId: string, filters?: ListFilters): Promise<RosterStudent[]>;
    create(schoolId: string, dto: CreateStudentDto): Promise<{
        code: string | null;
        email: string | null;
        id: string;
        createdAt: Date;
        schoolId: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        photoAssetId: string | null;
        isActive: boolean;
        classSectionId: string | null;
        admissionNo: string;
        rollNo: string | null;
        dob: Date | null;
        gender: string | null;
        guardianName: string | null;
        guardianPhone: string | null;
    }>;
    update(schoolId: string, id: string, dto: UpdateStudentDto): Promise<{
        code: string | null;
        email: string | null;
        id: string;
        createdAt: Date;
        schoolId: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        photoAssetId: string | null;
        isActive: boolean;
        classSectionId: string | null;
        admissionNo: string;
        rollNo: string | null;
        dob: Date | null;
        gender: string | null;
        guardianName: string | null;
        guardianPhone: string | null;
    }>;
    remove(schoolId: string, id: string): Promise<void>;
    /**
     * Creates the student's login and emails them a "welcome — set your
     * password" invite (see LoginInviteService). Replaces the old synthetic
     * undeliverable-email + on-screen-temp-password flow: the school admin now
     * supplies a REAL contact email, and the account is unusable until the
     * student follows the invite link and sets their own password.
     */
    createLogin(schoolId: string, studentId: string, dto: CreateLoginDto): Promise<LoginInviteResult>;
    /**
     * Next `{PREFIX}-NNNNN` for the school. The prefix is derived from the
     * school's name on first use (first three A–Z letters, padded with X) and
     * persisted on `School.codePrefix` so codes stay stable if the school is
     * renamed. Concurrency: the partial unique index on (schoolId, code) makes
     * a racing duplicate fail the caller's insert with P2002 rather than ever
     * storing two students under one code. Lexicographic max works while codes
     * share a width; widths only grow (padStart never truncates), and a new
     * width only starts past 99,999 students per school.
     */
    private allocateCode;
    /**
     * Re-sends the welcome invite for a student who already has a login (e.g.
     * the first email bounced, or the 30-minute link expired). Mints a fresh
     * token every time — old ones are simply left to expire/never get burned.
     */
    resendInvite(schoolId: string, studentId: string): Promise<LoginInviteResult>;
    private conflictFor;
    private validateClassSection;
}
//# sourceMappingURL=students.service.d.ts.map