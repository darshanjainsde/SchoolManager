import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { AttendanceBarService } from './attendance-bar.service';
import { AttendanceService } from './attendance.service';
import { NotifyLowAttendanceDto, SaveAttendanceDto } from './management.dto';
export declare class AttendanceController {
    private readonly attendance;
    private readonly bar;
    private readonly tenant;
    constructor(attendance: AttendanceService, bar: AttendanceBarService, tenant: TenantContextService);
    private sid;
    myClasses(u: SchoolJwtPayload): Promise<import("@skoolos/types").MyClassSection[]>;
    status(u: SchoolJwtPayload, date: string): Promise<import("@skoolos/types").ClassDayStatus[]>;
    /** The attendance bar (Phase 5·3): every child's percentage over a window,
     *  lowest first — declared above `@Get()` for the same route-order reason. */
    rates(classSectionId: string, u: SchoolJwtPayload, from?: string, to?: string): Promise<import("@skoolos/types").AttendanceRatesResult>;
    list(classSectionId: string, date: string): Promise<import("./attendance.service").AttendanceMarkResult[]>;
    save(dto: SaveAttendanceDto, u: SchoolJwtPayload): Promise<import("./attendance.service").SaveAttendanceResult>;
    /** One tap: privately tell the families below the benchmark (Phase 5·3). */
    notifyLow(dto: NotifyLowAttendanceDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").NotifyLowAttendanceResult>;
}
//# sourceMappingURL=attendance.controller.d.ts.map