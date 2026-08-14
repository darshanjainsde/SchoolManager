import { Injectable, Logger } from '@nestjs/common';
import { getLibraryPlatformPrisma, type MemberType } from '@library/db';

/**
 * Creates everything a school's library needs in order to work at all.
 *
 * WHY THIS EXISTS. Before this service, nothing in the codebase created a
 * `LibraryOrg` except `seed.ts`. There was no route, no service, no owner
 * action — a school's library could only be brought into existence by running
 * a seed script by hand. That is the single largest gap between "the library
 * is built" and "a school can be onboarded onto it".
 *
 * WHAT A WORKING LIBRARY ACTUALLY REQUIRES — each traced to the code that
 * breaks without it, rather than assumed:
 *
 *   LibraryOrg          × 1  — everything is scoped by orgId; RLS keys on it.
 *   Branch              × ≥1 — `Copy.branchId`, `Issue.branchId` and
 *                              `LibraryPeriod.branchId` are all NOT NULL.
 *   CirculationPolicy   × 3  — one org-default (branchId = null) per
 *                              MemberType. `loadPolicy` tries branch-specific,
 *                              falls back to org-default, and on a miss THROWS
 *                              NotFoundException. There is no code default.
 *   LibrarySettings     × 1  — columns have defaults, the ROW does not create
 *                              itself. `periods.service.ts` does `findUnique`
 *                              (null) and `update({where:{orgId}})`, which
 *                              throws P2025 on a missing row.
 *
 * Members are deliberately NOT provisioned. Enrolment is an explicit librarian
 * act, because `Member.code` is a number that gets written by hand into a
 * permanent physical register.
 *
 * THE HALF-PROVISIONED CASE is the one that matters, and it is why this runs in
 * ONE transaction. With an org but no CirculationPolicy, the catalogue loads,
 * the desk loads, everything looks fine — and then `POST /circulation/issue`
 * 404s on the first child at the counter, in front of a queue. A single
 * transaction means that state cannot be observed: either the whole library
 * exists or none of it does.
 *
 * IDEMPOTENT by construction, so it doubles as the "repair library" action.
 * Running it twice is a no-op that reports `alreadyPresent`; running it against
 * a partially-created library completes the missing pieces without disturbing
 * what a librarian has already configured.
 */

/** Per-member-type defaults. Matches `seed.ts` so seeded and provisioned orgs behave alike. */
const POLICY_DEFAULTS: Record<MemberType, {
  maxBooks: number;
  issueDays: number;
  renewLimit: number;
  maxReservations: number;
}> = {
  STUDENT: { maxBooks: 3, issueDays: 14, renewLimit: 1, maxReservations: 3 },
  TEACHER: { maxBooks: 10, issueDays: 30, renewLimit: 2, maxReservations: 5 },
  EXTERNAL: { maxBooks: 2, issueDays: 14, renewLimit: 0, maxReservations: 1 },
};

const MEMBER_TYPES: MemberType[] = ['STUDENT', 'TEACHER', 'EXTERNAL'];

export interface ProvisionInput {
  /** Sckools `School.id`. The link, and the idempotency key. */
  schoolId: string;
  /** Sckools `School.slug` — reused so a library is addressable by the same name. */
  slug: string;
  name: string;
  timezone?: string;
  currency?: string;
  /** Name of the first branch — the room itself. Most schools have exactly one. */
  branchName?: string;
}

export interface ProvisionReport {
  orgId: string;
  created: string[];
  alreadyPresent: string[];
}

/** What `ready` reports. Drives the feature gate: no org ⇒ the menu item must not render. */
export interface ReadinessReport {
  provisioned: boolean;
  orgId: string | null;
  missing: string[];
  /** Provisioned AND stocked. A menu item pointing at an empty library is worse than none. */
  live: boolean;
  copies: number;
}

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  async provision(input: ProvisionInput): Promise<ProvisionReport> {
    const prisma = getLibraryPlatformPrisma();
    const created: string[] = [];
    const alreadyPresent: string[] = [];

    // Platform client, not the tenant one: RLS scopes by `app.current_org`, and
    // the org being created is the thing that does not exist yet. There is no
    // org to set as the current one.
    return prisma.$transaction(async (tx) => {
      const existingOrg = await tx.libraryOrg.findUnique({
        where: { schoolId: input.schoolId },
        select: { id: true },
      });

      let orgId: string;
      if (existingOrg) {
        orgId = existingOrg.id;
        alreadyPresent.push('org');
      } else {
        const org = await tx.libraryOrg.create({
          data: {
            schoolId: input.schoolId,
            slug: input.slug,
            name: input.name,
            timezone: input.timezone ?? 'Asia/Kolkata',
            currency: input.currency ?? 'INR',
            // LIVE, not SETUP (the column default). `status` gates whether the
            // org resolves at all, so leaving it SETUP would provision a
            // library that then refuses every request — the auth-shaped
            // failure this service exists to remove.
            //
            // OrgStatus is SETUP | LIVE | SUSPENDED. There is no ACTIVE; the
            // first draft of this line said `'ACTIVE'` from memory and tsc
            // caught it.
            status: 'LIVE',
          },
          select: { id: true },
        });
        orgId = org.id;
        created.push('org');
      }

      // ── Branch ────────────────────────────────────────────────────────────
      // "any branch", not "a branch named X": a school that already made one
      // must not get a second. Copies and issues are pinned to a branch, so a
      // duplicate would split the collection in two.
      const branch = await tx.branch.findFirst({ where: { orgId }, select: { id: true } });
      if (branch) {
        alreadyPresent.push('branch');
      } else {
        await tx.branch.create({
          data: { orgId, name: input.branchName ?? 'Main library', code: 'MAIN' },
        });
        created.push('branch');
      }

      // ── Circulation policies ──────────────────────────────────────────────
      for (const memberType of MEMBER_TYPES) {
        const existing = await tx.circulationPolicy.findFirst({
          where: { orgId, branchId: null, memberType },
          select: { id: true },
        });
        if (existing) {
          alreadyPresent.push(`policy:${memberType}`);
          continue;
        }
        const d = POLICY_DEFAULTS[memberType];
        await tx.circulationPolicy.create({
          data: {
            orgId,
            branchId: null,
            memberType,
            maxBooks: d.maxBooks,
            issueDays: d.issueDays,
            renewLimit: d.renewLimit,
            renewDays: d.issueDays,
            // Fines are configured but OFF: `LibrarySettings.chargeStudentFines`
            // defaults false. The engine must be ready the day a school turns it
            // on, without billing anybody in the meantime.
            finePerDay: 1,
            graceDays: 3,
            maxFine: 100,
            maxReservations: d.maxReservations,
            reservedShelfDays: 5,
            maxOutstandingFine: 50,
          },
        });
        created.push(`policy:${memberType}`);
      }

      // ── Settings ──────────────────────────────────────────────────────────
      const settings = await tx.librarySettings.findUnique({
        where: { orgId },
        select: { id: true },
      });
      if (settings) {
        alreadyPresent.push('settings');
      } else {
        // Column defaults carry the values (fines off, attendance on). The row
        // is what has to exist.
        await tx.librarySettings.create({ data: { orgId } });
        created.push('settings');
      }

      this.logger.log(
        `provisioned library for school ${input.schoolId}: created=[${created.join(', ')}] ` +
          `alreadyPresent=[${alreadyPresent.join(', ')}]`,
      );
      return { orgId, created, alreadyPresent };
    });
  }

  /**
   * Is this school's library usable, and if not, what is missing?
   *
   * Two distinct answers, because they gate different things:
   *   `provisioned` — the rows exist. Gates the API: an unprovisioned school
   *                   must get feature-disabled, never a 401 (which reads as
   *                   "you are not allowed" for a library that simply is not
   *                   there) and never a 500.
   *   `live`        — provisioned AND has at least one copy. Gates the student
   *                   and teacher MENU ITEM. The gap between "admin enabled
   *                   Library" and "there are books in it" is weeks of real
   *                   work, and a tab opening onto an empty screen is the
   *                   impression 800 students form of the feature.
   */
  async ready(schoolId: string): Promise<ReadinessReport> {
    const prisma = getLibraryPlatformPrisma();

    const org = await prisma.libraryOrg.findUnique({
      where: { schoolId },
      select: { id: true },
    });
    if (!org) {
      return {
        provisioned: false,
        orgId: null,
        missing: ['org', 'branch', 'policy:STUDENT', 'policy:TEACHER', 'policy:EXTERNAL', 'settings'],
        live: false,
        copies: 0,
      };
    }

    const orgId = org.id;
    const [branchCount, policies, settings, copies] = await Promise.all([
      prisma.branch.count({ where: { orgId } }),
      prisma.circulationPolicy.findMany({
        where: { orgId, branchId: null },
        select: { memberType: true },
      }),
      prisma.librarySettings.findUnique({ where: { orgId }, select: { id: true } }),
      prisma.copy.count({ where: { orgId } }),
    ]);

    const havePolicy = new Set(policies.map((p) => p.memberType));
    const missing: string[] = [];
    if (branchCount === 0) missing.push('branch');
    for (const t of MEMBER_TYPES) if (!havePolicy.has(t)) missing.push(`policy:${t}`);
    if (!settings) missing.push('settings');

    const provisioned = missing.length === 0;
    return { provisioned, orgId, missing, live: provisioned && copies > 0, copies };
  }
}
