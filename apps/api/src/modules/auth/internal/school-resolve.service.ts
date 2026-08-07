import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';

/**
 * Matches AuthService's code-shaped-identifier test exactly: the two must
 * agree, or an identifier could resolve a school here and then take the
 * username path at login (or vice versa).
 */
// AAA-00000 is THE format — five digits minimum, matching the generator
// (students.service.ts). When stored data disagreed (the 2026-08-07 seed
// carried RPS-0021), the DATA was migrated to this format, not the other
// way round: one canonical shape, printed on cards and shown on the gate.
const STUDENT_CODE_RE = /^[A-Za-z]{3}-\d{5,}$/;

/** A code or email resolving to more than this many schools is returned
 *  truncated — the client tries candidates in order, so a pathological
 *  identifier can't fan a single login out into many attempts. */
const MAX_CANDIDATES = 3;

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
@Injectable()
export class SchoolResolveService {
  private readonly env = loadEnv();

  async resolve(identifier: string): Promise<string[]> {
    const id = identifier.trim();
    const platform = getPlatformPrisma();

    let slugs: string[] = [];
    if (STUDENT_CODE_RE.test(id)) {
      const students = await platform.student.findMany({
        where: { code: id.toUpperCase(), school: { status: { not: 'SUSPENDED' } } },
        select: { school: { select: { slug: true } } },
        take: MAX_CANDIDATES,
      });
      slugs = students.map((s) => s.school.slug);
    } else if (id.includes('@')) {
      const users = await platform.user.findMany({
        where: {
          email: { equals: id.toLowerCase(), mode: 'insensitive' },
          isActive: true,
          // Platform-owner accounts have no school; they log in on the web
          // console, never through the app gate.
          schoolId: { not: null },
          school: { status: { not: 'SUSPENDED' } },
        },
        select: { school: { select: { slug: true } } },
        take: MAX_CANDIDATES,
      });
      slugs = users.map((u) => u.school!.slug);
    }

    return [...new Set(slugs)].map((slug) => `${slug}.${this.env.PLATFORM_HOST}`);
  }
}
