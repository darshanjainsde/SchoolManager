export type Role = 'ORG_OWNER' | 'LIBRARIAN' | 'ASSISTANT' | 'MEMBER';

export interface EndpointSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  /** Roles that must receive a non-401/403. Every other role must be denied. */
  roles: Role[];
  /** True when the route is deliberately reachable without a token. */
  anonymous?: boolean;
  /** A minimal valid body, for methods that need one. */
  body?: Record<string, unknown>;
}

const ALL_STAFF: Role[] = ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER'];
const WRITERS: Role[] = ['ORG_OWNER', 'LIBRARIAN'];
const READERS: Role[] = ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT'];

export const ENDPOINTS: EndpointSpec[] = [
  { method: 'GET', path: '/live', roles: [], anonymous: true },
  { method: 'GET', path: '/ready', roles: [], anonymous: true },
  { method: 'POST', path: '/auth/login', roles: [], anonymous: true, body: { identifier: 'x@y.z', password: 'nope' } },
  { method: 'POST', path: '/auth/refresh', roles: [], anonymous: true, body: { refreshToken: 'nope' } },

  // Catalog — ASSISTANT is read-only (GET only), LIBRARIAN/ORG_OWNER read+write,
  // MEMBER gets search + title detail only. See task-6-brief.md.
  { method: 'GET', path: '/catalog/titles', roles: ALL_STAFF },
  { method: 'POST', path: '/catalog/titles', roles: WRITERS, body: { title: 'Authz Matrix Probe Title' } },
  { method: 'GET', path: '/catalog/titles/:id', roles: ALL_STAFF },
  { method: 'PATCH', path: '/catalog/titles/:id', roles: WRITERS, body: { title: 'Updated Probe Title' } },
  { method: 'DELETE', path: '/catalog/titles/:id', roles: WRITERS },
  {
    method: 'POST',
    path: '/catalog/titles/:id/copies',
    roles: WRITERS,
    body: { branchId: '11111111-1111-4111-8111-111111111111', barcode: 'AUTHZ-MATRIX-PROBE-0001' },
  },
  { method: 'PATCH', path: '/catalog/copies/:id', roles: WRITERS, body: { shelf: 'A1' } },
  { method: 'GET', path: '/catalog/copies/by-barcode/:barcode', roles: READERS },
  { method: 'GET', path: '/catalog/categories', roles: READERS },
  { method: 'POST', path: '/catalog/categories', roles: WRITERS, body: { name: 'Authz Matrix Probe Category' } },

  // Task 7 — bulk import + ISBN lookup. POST is multipart (a CSV file), not
  // JSON, so the generic per-role loop's `.send(ep.body ?? {})` sends an
  // empty JSON body rather than a real file; that is fine for authz
  // purposes — guards run before the handler body, so a denied role still
  // gets 401/403, and an allowed role reaching the handler with no file
  // attached gets a 400 from the controller's own validation, which is a
  // non-401/403 response same as any other allowed row.
  { method: 'POST', path: '/catalog/import/titles', roles: WRITERS },
  { method: 'GET', path: '/catalog/isbn/:isbn', roles: READERS },

  // Task 8 — circulation desk. ORG_OWNER/LIBRARIAN/ASSISTANT all work the
  // desk; MEMBER is denied (a member cannot issue/return their own or
  // anyone else's loan through this route). Bodies name a barcode that
  // legitimately won't resolve to a real Copy for most roles under test —
  // that's fine for authz purposes, same reasoning as catalog/import/titles
  // above: guards run before the handler body, so a denied role still gets
  // 401/403, and an allowed role reaching the handler with no matching copy
  // gets a 404, which is a non-401/403 response same as any other allowed row.
  { method: 'POST', path: '/circulation/issue', roles: READERS, body: { barcode: 'AUTHZ-MATRIX-PROBE-ISSUE', memberId: '11111111-1111-4111-8111-111111111111' } },
  { method: 'POST', path: '/circulation/return', roles: READERS, body: { barcode: 'AUTHZ-MATRIX-PROBE-RETURN' } },
];
