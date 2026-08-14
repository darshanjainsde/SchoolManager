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
  // ── Machine-only routes: `anonymous: false` with NO roles ────────────────
  // A Vercel cron (or the platform calling provisioning) carries no tenant
  // host, no session and no user, so no ROLE may reach these — they are
  // authorised by a bearer secret inside the handler instead. `anonymous:
  // false` + `roles: []` is exactly that claim: every role is denied, and the
  // no-bearer and cross-tenant checks below apply too.
  //
  // These were `anonymous: true` until 2026-08-14, which asserts the opposite —
  // "no role is denied". That was TRUE at the time only because the handler
  // read `if (secret && ...)`, so an unset CRON_SECRET (which was the state in
  // every environment) left the route open to anyone. The matrix was therefore
  // encoding a vulnerability as the expected behaviour, and would have gone red
  // if anybody had fixed it — which is how it was found.
  { method: 'GET', path: '/internal/cron/notification-outbox', roles: [], anonymous: false },

  // Provisioning CREATES a school's library. No role may call it; the platform
  // authorises with PROVISIONING_SECRET, deliberately a different value from
  // CRON_SECRET so a scheduler's credential cannot create orgs.
  { method: 'POST', path: '/internal/provisioning', roles: [], anonymous: false,
    body: { schoolId: '00000000-0000-4000-8000-000000000000', slug: 'nope', name: 'nope' } },
  { method: 'GET', path: '/internal/provisioning/ready/:schoolId', roles: [], anonymous: false },
  { method: 'GET', path: '/live', roles: [], anonymous: true },
  { method: 'GET', path: '/ready', roles: [], anonymous: true },
  { method: 'POST', path: '/auth/login', roles: [], anonymous: true, body: { identifier: 'x@y.z', password: 'nope' } },
  { method: 'POST', path: '/auth/refresh', roles: [], anonymous: true, body: { refreshToken: 'nope' } },
  // P4 — trading a Sckools sign-in for a library one. Anonymous by definition:
  // the caller has no library session yet, which is the entire point.
  { method: 'POST', path: '/auth/sckools/exchange', roles: [], anonymous: true, body: { sckoolsToken: 'nope' } },

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
    body: { branchId: '11111111-1111-4111-8111-111111111111', accessionNumber: 'AUTHZ-MATRIX-PROBE-0001' },
  },
  { method: 'PATCH', path: '/catalog/copies/:id', roles: WRITERS, body: { shelf: 'A1' } },
  { method: 'GET', path: '/catalog/copies/by-accessionNumber/:accessionNumber', roles: READERS },
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
  // anyone else's issue through this route). Bodies name a accessionNumber that
  // legitimately won't resolve to a real Copy for most roles under test —
  // that's fine for authz purposes, same reasoning as catalog/import/titles
  // above: guards run before the handler body, so a denied role still gets
  // 401/403, and an allowed role reaching the handler with no matching copy
  // gets a 404, which is a non-401/403 response same as any other allowed row.
  { method: 'POST', path: '/circulation/issue', roles: READERS, body: { accessionNumber: 'AUTHZ-MATRIX-PROBE-ISSUE', memberId: '11111111-1111-4111-8111-111111111111' } },
  { method: 'POST', path: '/circulation/return', roles: READERS, body: { accessionNumber: 'AUTHZ-MATRIX-PROBE-RETURN' } },

  // P3 — reporting a loss. Same desk roles as issue/return, and deliberately so:
  // the first thing this does is STOP the child's late charge growing, so gating
  // it behind a role the person at the counter may not hold would keep the
  // charge running while they fetch someone senior. Forgiving the money
  // afterwards is the restricted action (see /circulation/fines/:id/waive,
  // which excludes ASSISTANT); recording the loss is not.
  { method: 'POST', path: '/circulation/lost', roles: READERS, body: { accessionNumber: 'AUTHZ-MATRIX-PROBE-LOST' } },

  // Self-report is the one circulation route a MEMBER may call: it is a child
  // saying "I lost my own book". Safety does not come from the role here — the
  // service resolves the member from the caller's OWN login and will only touch
  // an issue in their hands — so an allowed role with nothing to report gets a
  // 404, same as every other probe row above.
  { method: 'POST', path: '/circulation/lost/self-report', roles: ALL_STAFF, body: { accessionNumber: 'AUTHZ-MATRIX-PROBE-SELF-LOST' } },
  // Confirm and reject turn a report into money, or undo it. Staff only, and
  // narrower than the desk: no ASSISTANT.
  { method: 'POST', path: '/circulation/lost/:id/confirm', roles: WRITERS, body: {} },
  { method: 'POST', path: '/circulation/lost/:id/reject', roles: WRITERS, body: { reason: 'authz matrix probe' } },
  // Taking money at the desk is desk work, so ASSISTANT is included; forgiving
  // it is not, so write-off is WRITERS-only — the same split as fines/:id/waive.
  { method: 'POST', path: '/circulation/lost/:id/pay', roles: READERS, body: { method: 'CASH' } },
  { method: 'POST', path: '/circulation/lost/:id/write-off', roles: WRITERS, body: { approvedByNote: 'Authz matrix probe', reason: 'probe' } },
  // Clearing a charge in kind is forgiving money, so WRITERS. Marking a book
  // found is not — reversing must be as easy as reporting or nobody reports,
  // and the frozen late charge stands either way.
  { method: 'POST', path: '/circulation/lost/:id/replace', roles: WRITERS, body: { accessionNumber: 'AUTHZ-MATRIX-PROBE-REPL' } },
  // Forgiving money is WRITERS without exception: `found` clears the LOST
  // charge with a mechanical code, which also keeps it out of the collections
  // "let off" tile — an ASSISTANT doing that would leave no trace anywhere an
  // owner reads.
  { method: 'POST', path: '/circulation/lost/:id/found', roles: WRITERS },
  { method: 'POST', path: '/circulation/lost/missing', roles: READERS, body: { accessionNumber: 'AUTHZ-MATRIX-PROBE-MISSING' } },
  // Deciding whether the school owes a family money is WRITERS.
  { method: 'POST', path: '/circulation/lost/:id/turned-up', roles: WRITERS, body: { outcome: 'FAMILY_KEEPS' } },
  { method: 'POST', path: '/circulation/lost/:id/refunded', roles: WRITERS, body: {} },
  { method: 'GET',  path: '/circulation/lost', roles: READERS },
  { method: 'GET',  path: '/circulation/lost/refunds-owed', roles: WRITERS },

  // Task 9 — renew and reservations. Same desk-role split as issue/return: ORG_OWNER/
  // LIBRARIAN/ASSISTANT work the desk, MEMBER is denied. Ids in bodies are
  // well-formed UUIDs that legitimately won't resolve to a real row for most
  // roles under test — guards run before the handler, so that's a 404 for an
  // allowed role, not a 401/403, same reasoning as circulation/issue above.
  { method: 'POST', path: '/circulation/renew', roles: READERS, body: { accessionNumber: 'AUTHZ-MATRIX-PROBE-RENEW' } },
  {
    method: 'POST',
    path: '/circulation/reservations',
    roles: READERS,
    body: { titleId: '11111111-1111-4111-8111-111111111111', memberId: '11111111-1111-4111-8111-111111111111' },
  },
  { method: 'DELETE', path: '/circulation/reservations/:id', roles: READERS },
  { method: 'GET', path: '/circulation/reservations', roles: READERS },

  // Task 10 — fines, waivers, day-end report. Waiver is a WRITERS-only action
  // (ASSISTANT must be denied — see fines.service.ts's `waive`); the rest are
  // desk reads.
  { method: 'GET', path: '/circulation/fines', roles: READERS },
  { method: 'POST', path: '/circulation/fines/:id/pay', roles: READERS, body: { method: 'CASH' } },
  { method: 'POST', path: '/circulation/fines/:id/waive', roles: WRITERS, body: { reason: 'Authz matrix probe', reasonCode: 'GOODWILL' } },
  { method: 'GET', path: '/circulation/dues', roles: READERS },
  // Money reporting is WRITERS: what the school collected and forgave is an
  // owner's view, not a counter view.
  { method: 'GET', path: '/circulation/collections', roles: WRITERS },
  { method: 'GET', path: '/circulation/waivers', roles: WRITERS },
  { method: 'GET', path: '/circulation/overdue', roles: READERS },
  { method: 'GET', path: '/circulation/day-report', roles: READERS },

  // Member lookup for the desk. READERS, so `MEMBER` is denied — a borrower
  // must not be able to enumerate the school roll, which for a school library
  // is a list of children's names.
  { method: 'GET', path: '/circulation/members', roles: READERS },

  // The one search box. ALL_STAFF including MEMBER: a student looking a book up
  // from their own app is the point, and the service returns only what that
  // role should see. Gated on CATALOG rather than CIRCULATION — searching is a
  // catalogue act, and a plan without lending should still be able to search.
  { method: 'GET', path: '/search/suggest', roles: ALL_STAFF },

  // P4 — a borrower's own account. ALL_STAFF including MEMBER, and the member
  // is resolved from the caller's OWN login inside the service, so there is no
  // id in any path or query that could be pointed at somebody else. A staff
  // login with no member row gets a 404, which is a non-401/403 the same as
  // every other allowed-role probe row here.
  { method: 'GET', path: '/me/issues', roles: ALL_STAFF },
  { method: 'GET', path: '/me/dues', roles: ALL_STAFF },
  { method: 'GET', path: '/me/history', roles: ALL_STAFF },
  { method: 'GET', path: '/me/availability/:titleId', roles: ALL_STAFF },

  // P5 — the accession register, stock take, weeding. MEMBER is denied
  // throughout: the register carries what the school paid for every copy, which
  // is an auditor's document rather than a reader's. Weeding is WRITERS —
  // removing a book nobody complained about is not desk work.
  { method: 'GET',  path: '/register', roles: READERS },
  { method: 'POST', path: '/register/stock-take', roles: READERS, body: { found: '1001-1002' } },
  { method: 'POST', path: '/register/stock-take/unaccounted', roles: READERS, body: { found: '1001' } },
  { method: 'POST', path: '/register/weed/:copyId', roles: WRITERS, body: { reason: 'probe', approvedByNote: 'probe' } },

  // Phase 2c — the library period. Setting the timetable and the room's capacity
  // is configuration (WRITERS); opening a visit and ticking a child present is
  // counter work, so ASSISTANT can do it. MEMBER is denied throughout — a child
  // has no business reading a class roster.
  { method: 'GET',    path: '/periods/settings', roles: READERS },
  { method: 'PATCH',  path: '/periods/settings', roles: WRITERS, body: { concurrentClassCapacity: 2 } },
  { method: 'GET',    path: '/periods', roles: READERS },
  { method: 'POST',   path: '/periods', roles: WRITERS, body: { branchId: '11111111-1111-4111-8111-111111111111', weekday: 2, period: 3, classRef: 'AUTHZ-PROBE' } },
  { method: 'DELETE', path: '/periods/:id', roles: WRITERS },
  { method: 'GET',    path: '/periods/visits/live', roles: READERS },
  { method: 'GET',    path: '/periods/visits', roles: READERS },
  { method: 'POST',   path: '/periods/visits/open', roles: READERS, body: { branchId: '11111111-1111-4111-8111-111111111111', classRef: 'AUTHZ-PROBE' } },
  { method: 'POST',   path: '/periods/visits/:id/close', roles: READERS },
  { method: 'POST',   path: '/periods/visits/:id/attendance', roles: READERS, body: { memberId: '11111111-1111-4111-8111-111111111111' } },
];
