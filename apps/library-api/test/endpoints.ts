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

export const ENDPOINTS: EndpointSpec[] = [
  { method: 'GET', path: '/live', roles: [], anonymous: true },
  { method: 'GET', path: '/ready', roles: [], anonymous: true },
  { method: 'POST', path: '/auth/login', roles: [], anonymous: true, body: { identifier: 'x@y.z', password: 'nope' } },
  { method: 'POST', path: '/auth/refresh', roles: [], anonymous: true, body: { refreshToken: 'nope' } },
];
