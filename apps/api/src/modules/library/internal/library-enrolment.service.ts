import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { withOrg, type LibraryTx } from '@library/db';

/**
 * Turns a school's roster into library members.
 *
 * WHY THIS IS THE PAYOFF OF MERGING. The standalone library needed an 800-row
 * member CSV with hand-typed class labels, re-typed every April as children move
 * up. Reading the roster deletes that permanently — and with it the spec's worst
 * design debt, `classRef` as free text where `6-B` vs `6B` vs `VI-B` silently
 * yields an empty roster.
 *
 * Members are NOT created by provisioning, deliberately. Provisioning makes a
 * library exist; enrolment decides who may borrow from it, and that is a
 * decision a school makes — some enrol one class at a time as the library
 * period starts running.
 *
 * IDEMPOTENT. Re-running enrols only people who are new, which is what makes it
 * the April action too: the new intake arrives, everyone else is untouched. It
 * never updates an existing member, because `Member.code` is a borrower number
 * written by hand into a permanent register and silently changing it would
 * orphan every entry already written down.
 */

export interface EnrolmentReport {
  enrolled: number;
  alreadyMembers: number;
  /** People with no Sckools login yet — they cannot be linked, so they are skipped. */
  skippedNoLogin: number;
}

@Injectable()
export class LibraryEnrolmentService {
  private readonly logger = new Logger(LibraryEnrolmentService.name);

  async enrolSchool(orgId: string, schoolId: string): Promise<EnrolmentReport> {
    // Platform client: this reads the roster across a school, and the read is
    // scoped by the explicit schoolId below rather than by a tenant GUC.
    const sckools = getPlatformPrisma();

    const [students, teachers] = await Promise.all([
      sckools.student.findMany({
        where: { schoolId, isActive: true },
        select: {
          userId: true,
          code: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          classSection: { select: { name: true, grade: { select: { name: true } } } },
        },
      }),
      sckools.teacher.findMany({
        where: { schoolId, isActive: true },
        select: { userId: true, firstName: true, lastName: true },
      }),
    ]);

    let enrolled = 0;
    let alreadyMembers = 0;
    let skippedNoLogin = 0;

    await withOrg(orgId, async (tx: LibraryTx) => {
      // One query, not one per person: an 800-student school would otherwise
      // make 800 round trips to answer a question one IN clause answers.
      const existing = new Set(
        (
          await tx.member.findMany({
            where: { orgId, externalRef: { not: null } },
            select: { externalRef: true },
          })
        ).map((m) => m.externalRef as string),
      );

      const branch = await tx.branch.findFirst({ where: { orgId }, select: { id: true } });

      for (const s of students) {
        if (!s.userId) { skippedNoLogin++; continue; }
        if (existing.has(s.userId)) { alreadyMembers++; continue; }

        // The school's own student code IS the borrower number. Reusing it
        // means one identity rather than two — the number already printed on
        // the child's card is the number in the register. `admissionNo` is the
        // fallback for a child whose login predates the code scheme.
        const code = s.code ?? s.admissionNo;

        await tx.member.create({
          data: {
            orgId,
            homeBranchId: branch?.id ?? null,
            code,
            externalRef: s.userId,
            memberType: 'STUDENT',
            firstName: s.firstName,
            lastName: s.lastName,
            // Built from the dominant `${grade}-${section}` form used across the
            // codebase. Still free text in the library schema, but no longer
            // hand-typed, which is what made it drift.
            classRef: s.classSection
              ? `${s.classSection.grade.name}-${s.classSection.name}`
              : null,
            status: 'ACTIVE',
          },
        });
        enrolled++;
      }

      for (const t of teachers) {
        if (!t.userId) { skippedNoLogin++; continue; }
        if (existing.has(t.userId)) { alreadyMembers++; continue; }

        // Teachers have no school-wide code, so the library mints one. Derived
        // from the user id rather than a counter: a counter would need a lock to
        // be safe under a concurrent re-run, and this needs neither while still
        // being stable across runs — the same teacher always gets the same code.
        const code = `T-${t.userId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

        await tx.member.create({
          data: {
            orgId,
            homeBranchId: branch?.id ?? null,
            code,
            externalRef: t.userId,
            memberType: 'TEACHER',
            firstName: t.firstName,
            lastName: t.lastName,
            classRef: null,
            status: 'ACTIVE',
          },
        });
        enrolled++;
      }
    });

    this.logger.log(
      `enrolled ${enrolled} into library ${orgId} (${alreadyMembers} already members, ${skippedNoLogin} without a login)`,
    );
    return { enrolled, alreadyMembers, skippedNoLogin };
  }
}
