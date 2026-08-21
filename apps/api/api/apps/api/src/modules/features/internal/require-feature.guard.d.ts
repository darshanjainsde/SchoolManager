import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureResolverService } from './feature-resolver.service';
import { TenantContextService } from '../../tenancy';
export declare class RequireFeatureGuard implements CanActivate {
    private readonly reflector;
    private readonly features;
    private readonly tenant;
    constructor(reflector: Reflector, features: FeatureResolverService, tenant: TenantContextService);
    canActivate(ctx: ExecutionContext): Promise<boolean>;
}
//# sourceMappingURL=require-feature.guard.d.ts.map