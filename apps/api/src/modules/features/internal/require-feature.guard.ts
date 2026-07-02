import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@skoolos/db';
import { REQUIRE_FEATURE } from './require-feature.decorator';
import { FeatureResolverService } from './feature-resolver.service';
import { TenantContextService } from '../../tenancy';

@Injectable()
export class RequireFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureResolverService,
    private readonly tenant: TenantContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<FeatureKey | undefined>(REQUIRE_FEATURE, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required) return true;
    const context = this.tenant.get();
    if (!context || context.kind !== 'tenant') throw new ForbiddenException('No tenant context');
    const schoolId = context.schoolId;
    const set = await this.features.getFeatures(schoolId);
    if (!set.has(required)) throw new ForbiddenException(`Feature ${required} not enabled for this school`);
    return true;
  }
}
