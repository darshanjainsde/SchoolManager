/**
 * Resolves a login identifier to the school host(s) it could belong to —
 * the mobile gate's replacement for the deleted "enter your school code"
 * screen. Runs BEFORE login, with no tenant context: the whole point is
 * that the app does not yet know which school it is talking to.
 *
 * Two identifier shapes resolve; everything else returns [] without a query:
 *  - student code (RAF-00042): the prefix is derived from the school name and
 *    NOT globally unique (Raffles and Rafael High could both be RAF-), so the
 *    lookup uses the FULL code across schools and may return several hosts.
 *  - email: unique per school, not globally — a teacher tutoring at two
 *    schools legitimately yields two candidates.
 *
 * The client attempts /auth/login against each candidate in order; the
 * password decides. Admission numbers deliberately do NOT resolve: they are
 * per-school serials ("1023") and would match half the platform.
 *
 * Enumeration: the response is a bare host list — no names, no account data —
 * and a host is the same public fact as the school's own website address.
 * The controller throttles this route like login.
 */
export declare class SchoolResolveService {
    private readonly env;
    resolve(identifier: string): Promise<string[]>;
}
//# sourceMappingURL=school-resolve.service.d.ts.map