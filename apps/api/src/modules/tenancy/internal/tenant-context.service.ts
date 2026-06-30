import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantContext =
  | { kind: 'tenant'; schoolId: string; hostname: string; schoolSlug: string }
  | { kind: 'platform'; hostname: string }
  | { kind: 'unknown'; hostname: string };

export type ResolvedTenant = Extract<TenantContext, { kind: 'tenant' }>;

/**
 * Single process-wide AsyncLocalStorage instance. Both the functional
 * middleware and the injectable service refer to the same store so context
 * set by the middleware is visible to services/controllers running inside
 * the same async stack.
 */
export const tenantStore = new AsyncLocalStorage<TenantContext>();

@Injectable()
export class TenantContextService {
  run<T>(ctx: TenantContext, fn: () => T): T {
    return tenantStore.run(ctx, fn);
  }

  get(): TenantContext | undefined {
    return tenantStore.getStore();
  }

  /** Throw if the current request isn't tenant-scoped. */
  requireTenant(): ResolvedTenant {
    const ctx = this.get();
    if (!ctx || ctx.kind !== 'tenant') {
      throw new Error('No tenant context in this request');
    }
    return ctx;
  }
}
