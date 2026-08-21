import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import { AccountService } from './account.service';
import { ChangePasswordDto } from './dto';
export declare class AccountController {
    private readonly account;
    private readonly tenantCtx;
    constructor(account: AccountService, tenantCtx: TenantContextService);
    changePassword(dto: ChangePasswordDto, user: SchoolJwtPayload): Promise<{
        ok: true;
    }>;
}
//# sourceMappingURL=account.controller.d.ts.map