import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { StaffAttendanceService } from './staff-attendance.service';
import { SaveStaffAttendanceDto } from './management.dto';
export declare class StaffAttendanceController {
    private readonly staffAttendance;
    private readonly tenant;
    constructor(staffAttendance: StaffAttendanceService, tenant: TenantContextService);
    private sid;
    list(date: string): Promise<import("./staff-attendance.service").StaffAttendanceListResult>;
    /**
     * The CALLER's own record — the STAFF portal's home screen. Overrides the
     * class-level `@Roles('SCHOOL_ADMIN')`; a literal `mine` segment, so it
     * never competes with `@Get('person')` below for route matching.
     */
    mine(month: string | undefined, u: SchoolJwtPayload): Promise<import("./staff-attendance.service").MyStaffAttendanceResult>;
    save(dto: SaveStaffAttendanceDto, u: SchoolJwtPayload): Promise<import("./staff-attendance.service").SaveStaffAttendanceResult>;
    /**
     * A literal `person` segment, not a `:id` param, so this never competes
     * with `@Get()` above for route matching regardless of declaration order.
     */
    person(kind: string, id: string, month: string): Promise<import("./staff-attendance.service").PersonAttendanceSummary>;
}
//# sourceMappingURL=staff-attendance.controller.d.ts.map