import type { SchoolJwtPayload } from './jwt-payload';

/**
 * A PolicyCheck receives the authenticated user and the resource (already
 * fetched from the DB, *under the tenant scope*) and returns true if access
 * is permitted. Throw to short-circuit with a custom message.
 *
 * Critical invariant: policy checks run AFTER the resource is fetched under
 * the request's tenant scope. RLS therefore guarantees the resource was
 * in-tenant before the policy ever sees it — the policy's job is the
 * intra-tenant authz (role + ownership).
 */
export type PolicyCheck<TResource> = (user: SchoolJwtPayload, resource: TResource) => boolean;
