import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import type { UnreadCountResult } from '@skoolos/types';
import { TenantContextService } from '../tenancy';
import { LeaveService } from './leave.service';
import { RegisterChangeService } from './register-change.service';
/**
 * The teacher "Requests" tile badge — ONE number = the caller's own PENDING
 * leave applications + register-change requests (the two things the Requests
 * screen lists together). Both underlying counts resolve ownership from the
 * caller's Teacher record, never from a client-supplied id. Reuses the existing
 * `LeaveService`/`RegisterChangeService` rather than a new query surface.
 */
export declare class RequestsController {
    private readonly leave;
    private readonly registerChanges;
    private readonly tenant;
    constructor(leave: LeaveService, registerChanges: RegisterChangeService, tenant: TenantContextService);
    pendingCount(u: SchoolJwtPayload): Promise<UnreadCountResult>;
}
//# sourceMappingURL=requests.controller.d.ts.map