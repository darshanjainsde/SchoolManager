import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { LeaveService } from './leave.service';
import { AssignSubstitutionDto, CreateLeaveDto } from './management.dto';
export declare class LeaveController {
    private readonly leave;
    private readonly tenant;
    constructor(leave: LeaveService, tenant: TenantContextService);
    private sid;
    apply(dto: CreateLeaveDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").LeaveApplication>;
    mine(u: SchoolJwtPayload): Promise<import("@skoolos/types").LeaveApplication[]>;
    coverage(from: string, to: string): Promise<{
        id: string;
        date: Date;
        classSectionId: string;
        classSectionName: string;
        periodId: string;
        periodLabel: string;
        originalTeacherName: string;
        substituteTeacherId: string | null;
        substituteTeacherName: string | null;
    }[]>;
    list(status?: string): Promise<{
        teacherName: string;
        status: import("@skoolos/db").$Enums.LeaveStatus;
        type: import("@skoolos/db").$Enums.LeaveType;
        id: string;
        createdAt: Date;
        schoolId: string;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        teacherId: string;
        reviewedAt: Date | null;
        reviewedById: string | null;
    }[]>;
    approve(id: string, u: SchoolJwtPayload): Promise<{
        gaps: number;
    }>;
    reject(id: string, u: SchoolJwtPayload): Promise<{
        status: import("@skoolos/db").$Enums.LeaveStatus;
        type: import("@skoolos/db").$Enums.LeaveType;
        id: string;
        createdAt: Date;
        schoolId: string;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        teacherId: string;
        reviewedAt: Date | null;
        reviewedById: string | null;
    }>;
    /**
     * Open to both roles — `LeaveService.cancel` enforces that a TEACHER
     * caller may only cancel their OWN application; a SCHOOL_ADMIN may cancel
     * any.
     */
    cancel(id: string, u: SchoolJwtPayload): Promise<{
        status: "CANCELLED";
        restoredDates: number;
    }>;
}
/**
 * Kept in this file (rather than a new `substitution.controller.ts`) since it
 * shares `LeaveService` and its route prefix — `manage/substitution` — is the
 * counterpart resource created by `LeaveService.approve`.
 */
export declare class SubstitutionController {
    private readonly leave;
    private readonly tenant;
    constructor(leave: LeaveService, tenant: TenantContextService);
    private sid;
    assign(id: string, dto: AssignSubstitutionDto): Promise<{
        date: Date;
        id: string;
        createdAt: Date;
        schoolId: string;
        classSectionId: string;
        periodId: string;
        originalTeacherId: string;
        substituteTeacherId: string | null;
        reason: string | null;
    }>;
    clear(id: string): Promise<{
        date: Date;
        id: string;
        createdAt: Date;
        schoolId: string;
        classSectionId: string;
        periodId: string;
        originalTeacherId: string;
        substituteTeacherId: string | null;
        reason: string | null;
    }>;
}
//# sourceMappingURL=leave.controller.d.ts.map