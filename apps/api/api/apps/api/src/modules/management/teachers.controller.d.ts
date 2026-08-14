import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { TeachersService } from './teachers.service';
import { CreateLoginDto, CreateTeacherDto, UpdateTeacherDto } from './management.dto';
export declare class TeachersController {
    private readonly teachers;
    private readonly tenant;
    constructor(teachers: TeachersService, tenant: TenantContextService);
    private sid;
    list(): Promise<({} & {
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
     * Static path — must stay declared above any future `@Get(':id')` on this
     * controller (there isn't one today), or Nest would match `me` as the
     * `:id` param the moment one is added. `RolesGuard`/`@Roles` are
     * method-level (mirroring `createLogin`/`resendInvite` below) because this
     * is the one GET on this controller that is TEACHER-only, not open to
     * every MANAGEMENT-feature role.
     */
    me(u: SchoolJwtPayload): Promise<import("@skoolos/types").TeacherProfile>;
    create(dto: CreateTeacherDto): Promise<{
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
    update(id: string, dto: UpdateTeacherDto): Promise<{
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
    remove(id: string): Promise<void>;
    /**
     * Login-invite routes are SCHOOL_ADMIN-only (mirrors StudentsController),
     * so RolesGuard + @Roles are applied per-handler here rather than at the
     * class level — the other handlers on this controller intentionally stay
     * open to any authenticated MANAGEMENT-feature role (e.g. TEACHER reads
     * `/manage/teachers` from the classes/timetable pages).
     */
    createLogin(id: string, dto: CreateLoginDto): Promise<import("./students.service").LoginInviteResult>;
    resendInvite(id: string): Promise<import("./students.service").LoginInviteResult>;
    /**
     * Phase 5·1 — "remove from this school": deactivate + disable the login
     * (never a hard delete), freeing the teacher for onboarding elsewhere.
     */
    release(id: string): Promise<{
        released: true;
    }>;
}
//# sourceMappingURL=teachers.controller.d.ts.map