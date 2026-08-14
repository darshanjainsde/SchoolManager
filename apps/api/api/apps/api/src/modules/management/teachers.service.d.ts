import type { TeacherProfile } from '@skoolos/types';
import { PasswordService } from '../auth';
import { LoginInviteService } from './internal/login-invite.service';
import type { CreateLoginDto, CreateTeacherDto, UpdateTeacherDto } from './management.dto';
import type { LoginInviteResult } from './students.service';
export type { TeacherProfile };
export declare class TeachersService {
    private readonly passwords;
    private readonly invites;
    constructor(passwords: PasswordService, invites: LoginInviteService);
    list(schoolId: string): Promise<({} & {
        email: string | null;
        id: string;
        schoolId: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
        photoAssetId: string | null;
        primarySubjectId: string | null;
        bio: string | null;
        isActive: boolean;
    })[]>;
    /**
     * The caller's own Teacher row for `GET /manage/teachers/me` — no id in
     * the URL, so a TEACHER can only ever read their own profile. A 404 here
     * means the TEACHER-role login has no linked Teacher row (deleted out from
     * under it); RolesGuard already excludes SCHOOL_ADMIN, who wouldn't have
     * one either but for a different, unremarkable reason.
     */
    me(schoolId: string, userId: string): Promise<TeacherProfile>;
    create(schoolId: string, dto: CreateTeacherDto): Promise<{
        email: string | null;
        id: string;
        schoolId: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
        photoAssetId: string | null;
        primarySubjectId: string | null;
        bio: string | null;
        isActive: boolean;
    }>;
    update(schoolId: string, id: string, dto: UpdateTeacherDto): Promise<{
        email: string | null;
        id: string;
        schoolId: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
        photoAssetId: string | null;
        primarySubjectId: string | null;
        bio: string | null;
        isActive: boolean;
    }>;
    remove(schoolId: string, id: string): Promise<void>;
    /**
     * "Remove from this school" (Phase 5·1) — the clean off-board that FREES a
     * teacher to be onboarded elsewhere. Deactivates rather than deletes (a
     * hard delete fails on references and erases history): Teacher.isActive
     * false + their login disabled and every session revoked. The one-school
     * guard in `createLogin` only blocks on ACTIVE rows, so after this the new
     * school onboards them normally.
     */
    release(schoolId: string, id: string): Promise<{
        released: true;
    }>;
    /**
     * Creates the teacher's login and emails a "welcome — set your password"
     * invite. `dto.email` falls back to the teacher's existing contact email
     * (Teacher.email) when omitted — either way a real, usable address is
     * required to send the invite.
     */
    createLogin(schoolId: string, teacherId: string, dto: CreateLoginDto): Promise<LoginInviteResult>;
    /** Re-sends the welcome invite for a teacher who already has a login. */
    resendInvite(schoolId: string, teacherId: string): Promise<LoginInviteResult>;
    private conflictFor;
}
//# sourceMappingURL=teachers.service.d.ts.map