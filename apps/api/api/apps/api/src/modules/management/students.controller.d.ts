import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { StudentsService } from './students.service';
import { CreateLoginDto, CreateStudentDto, UpdateStudentDto } from './management.dto';
export declare class StudentsController {
    private readonly students;
    private readonly tenant;
    constructor(students: StudentsService, tenant: TenantContextService);
    private sid;
    /**
     * Read-only roster. Teachers need this to render names next to the
     * studentIds returned by /manage/attendance and to enter exam results, so
     * the handler-level @Roles widens the class-level SCHOOL_ADMIN rule (the
     * RolesGuard resolves handler metadata first). Every mutating handler below
     * stays SCHOOL_ADMIN-only.
     *
     * A TEACHER is NOT an administrator of the school's student records:
     *  - `classSectionId` is REQUIRED for them, so they can only pull one class
     *    section at a time rather than the entire school's minor roster; and
     *  - they get the `roster` projection ({ id, firstName, lastName, rollNo }),
     *    which omits guardianName / guardianPhone / dob / gender / admissionNo.
     *
     * SCHOOL_ADMIN keeps the original contract (optional filter, full rows) —
     * the admin students screen depends on it. The projection is passed to the
     * service explicitly; the service never inspects the caller's role.
     */
    list(u: SchoolJwtPayload, classSectionId?: string): Promise<import("@skoolos/types").RosterStudent[]>;
    create(dto: CreateStudentDto): Promise<{
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
    createLogin(id: string, dto: CreateLoginDto): Promise<import("./students.service").LoginInviteResult>;
    resendInvite(id: string): Promise<import("./students.service").LoginInviteResult>;
    update(id: string, dto: UpdateStudentDto): Promise<{
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
    remove(id: string): Promise<void>;
}
//# sourceMappingURL=students.controller.d.ts.map