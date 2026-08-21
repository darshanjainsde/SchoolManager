import { CanActivate, ExecutionContext } from '@nestjs/common';
import { TenantContextService } from '../../modules/tenancy';
export declare class OwnerHostGuard implements CanActivate {
    private readonly tenant;
    constructor(tenant: TenantContextService);
    canActivate(_ctx: ExecutionContext): boolean;
}
//# sourceMappingURL=owner-host.guard.d.ts.map