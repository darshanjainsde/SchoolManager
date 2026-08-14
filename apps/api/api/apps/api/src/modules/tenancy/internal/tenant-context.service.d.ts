import { AsyncLocalStorage } from 'node:async_hooks';
export type TenantContext = {
    kind: 'tenant';
    schoolId: string;
    hostname: string;
    schoolSlug: string;
} | {
    kind: 'platform';
    hostname: string;
} | {
    kind: 'unknown';
    hostname: string;
};
export type ResolvedTenant = Extract<TenantContext, {
    kind: 'tenant';
}>;
/**
 * Single process-wide AsyncLocalStorage instance. Both the functional
 * middleware and the injectable service refer to the same store so context
 * set by the middleware is visible to services/controllers running inside
 * the same async stack.
 */
export declare const tenantStore: AsyncLocalStorage<TenantContext>;
export declare class TenantContextService {
    run<T>(ctx: TenantContext, fn: () => T): T;
    get(): TenantContext | undefined;
    /** Throw if the current request isn't tenant-scoped. */
    requireTenant(): ResolvedTenant;
}
//# sourceMappingURL=tenant-context.service.d.ts.map