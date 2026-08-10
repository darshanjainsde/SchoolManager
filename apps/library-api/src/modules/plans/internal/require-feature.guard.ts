import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanResolverService } from './plan-resolver.service';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator';
import type { CapabilityKey } from './resolve';

/**
 * Capability gate. Absence of @RequireFeature means no restriction — this
 * guard never resolves a plan for an undecorated route, mirroring
 * BranchScopeGuard's "nothing requested, nothing to check" shape.
 *
 * When capabilities ARE required, a request without a host-resolved tenant
 * org is rejected with 401 (we don't know whose plan to check), never
 * allowed through and never a crash. There is no global JWT/tenancy guard by
 * design (see LibJwtGuard), so req.org may legitimately be absent or
 * "unknown" on a misconfigured or unauthenticated route.
 */
@Injectable()
export class RequireFeatureGuard implements CanActivate {
  // Explicit @Inject(): tsx does not reliably emit design:paramtypes, so a
  // bare-typed constructor param can silently resolve to undefined — in a
  // guard that is a fail-open risk, the same hazard documented on LibJwtGuard
  // and PlansModule's own factory provider.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PlanResolverService) private readonly plans: PlanResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<CapabilityKey[] | undefined>(REQUIRE_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    if (req.org?.kind !== 'tenant') throw new UnauthorizedException();

    const { capabilities } = await this.plans.forOrg(req.org.orgId);
    const missing = required.filter((key) => !capabilities.has(key));
    if (missing.length > 0) {
      // Names only the requested-and-missing keys — the caller already knows
      // the full set it asked for via @RequireFeature, and "which plan tier
      // you're actually on" is never disclosed here.
      throw new ForbiddenException(`This action requires: ${missing.join(', ')}. Upgrade your plan to enable it.`);
    }
    return true;
  }
}
