import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { RegisterChangeService } from './register-change.service';
import { CreateRegisterChangeDto } from './management.dto';
export declare class RegisterChangeController {
    private readonly svc;
    private readonly tenant;
    constructor(svc: RegisterChangeService, tenant: TenantContextService);
    private sid;
    mine(u: SchoolJwtPayload): Promise<import("./register-change.service").RegisterChangeRow[]>;
    request(dto: CreateRegisterChangeDto, u: SchoolJwtPayload): Promise<import("./register-change.service").RegisterChangeRow>;
    pending(): Promise<import("./register-change.service").RegisterChangeRow[]>;
    approve(id: string, u: SchoolJwtPayload): Promise<import("./register-change.service").RegisterChangeRow>;
    reject(id: string, u: SchoolJwtPayload): Promise<import("./register-change.service").RegisterChangeRow>;
}
//# sourceMappingURL=register-change.controller.d.ts.map