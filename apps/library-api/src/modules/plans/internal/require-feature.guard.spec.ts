import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequireFeatureGuard } from './require-feature.guard';
import { RequireFeature } from './require-feature.decorator';
import { PlanResolverService, type PlanStore, type PlanCache } from './plan-resolver.service';
import type { PlanKey } from './resolve';

const ORG = '55555555-5555-4555-8555-555555555555';
const TENANT = { kind: 'tenant', orgId: ORG, orgSlug: 'org', hostname: 'org.example.com' };

function makeContext(handler: unknown, req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function planService(plan: PlanKey): PlanResolverService {
  const store: PlanStore = { findOrgPlan: async () => ({ plan, overrides: [] }) };
  const cache: PlanCache = { get: async () => null, set: async () => {}, del: async () => {} };
  return new PlanResolverService(store, cache);
}

describe('RequireFeatureGuard', () => {
  const reflector = new Reflector();

  it('allows a handler with no @RequireFeature decorator, even with no org resolved', async () => {
    class Ctrl {
      plain(): void {}
    }
    const guard = new RequireFeatureGuard(reflector, planService('FREE'));
    await expect(guard.canActivate(makeContext(Ctrl.prototype.plain, {}))).resolves.toBe(true);
  });

  it('rejects with 401 when a capability is required but no tenant org has been resolved', async () => {
    class Ctrl {
      @RequireFeature('MULTI_BRANCH')
      gated(): void {}
    }
    const guard = new RequireFeatureGuard(reflector, planService('FREE'));
    await expect(guard.canActivate(makeContext(Ctrl.prototype.gated, {}))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects with 401 when req.org is present but unresolved ("unknown" host)', async () => {
    class Ctrl {
      @RequireFeature('MULTI_BRANCH')
      gated(): void {}
    }
    const guard = new RequireFeatureGuard(reflector, planService('FREE'));
    const req = { org: { kind: 'unknown', hostname: 'nope.example.com' } };
    await expect(guard.canActivate(makeContext(Ctrl.prototype.gated, req))).rejects.toThrow(UnauthorizedException);
  });

  it('allows when the org plan includes the required capability', async () => {
    class Ctrl {
      @RequireFeature('MULTI_BRANCH')
      gated(): void {}
    }
    const guard = new RequireFeatureGuard(reflector, planService('PRO'));
    const req = { org: TENANT };
    await expect(guard.canActivate(makeContext(Ctrl.prototype.gated, req))).resolves.toBe(true);
  });

  it('rejects with 403 naming the missing capability when the plan lacks it', async () => {
    class Ctrl {
      @RequireFeature('MULTI_BRANCH')
      gated(): void {}
    }
    const guard = new RequireFeatureGuard(reflector, planService('FREE'));
    const req = { org: TENANT };
    await expect(guard.canActivate(makeContext(Ctrl.prototype.gated, req))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(makeContext(Ctrl.prototype.gated, req))).rejects.toThrow(/MULTI_BRANCH/);
  });

  it('names only the capabilities actually missing when several are required', async () => {
    class Ctrl {
      // CATALOG is on FREE already; MULTI_BRANCH is not — only the latter should be named.
      @RequireFeature('CATALOG', 'MULTI_BRANCH')
      gated(): void {}
    }
    const guard = new RequireFeatureGuard(reflector, planService('FREE'));
    const req = { org: TENANT };
    try {
      await guard.canActivate(makeContext(Ctrl.prototype.gated, req));
      throw new Error('expected canActivate to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toMatch(/MULTI_BRANCH/);
      expect((err as Error).message).not.toMatch(/CATALOG/);
    }
  });
});
