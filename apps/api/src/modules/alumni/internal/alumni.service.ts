import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { defaultPrivacy, toGraduationRows } from './homecoming-rules';
import type {
  DecideClaimDto,
  GraduateBatchDto,
  ListAlumniQueryDto,
  SaveBatchStrengthDto,
  SetTrustedDto,
} from './alumni.dto';

export interface RollCallRow {
  batchYear: number;
  /** Alumni rows the school actually holds for that year. */
  found: number;
  /** Of those, how many a human has verified. */
  verified: number;
  /** From the bound register. 0 = never counted, which the UI shows as unknown. */
  registerStrength: number;
  /** null when registerStrength is 0 — a percentage with no denominator is a lie. */
  coverage: number | null;
  /** True once the year graduated THROUGH Sckools, i.e. every row has a studentId. */
  fromSckools: boolean;
}

@Injectable()
export class AlumniService {
  // ─── Roster ────────────────────────────────────────────────────────────────

  async list(schoolId: string, q: ListAlumniQueryDto) {
    const take = Math.min(q.take ?? 50, 200);
    const skip = q.skip ?? 0;
    const where: Record<string, unknown> = { schoolId };
    if (q.batchYear) where.batchYear = q.batchYear;
    if (q.status) where.status = q.status;
    if (q.q) {
      where.OR = [
        { firstName: { contains: q.q, mode: 'insensitive' } },
        { lastName: { contains: q.q, mode: 'insensitive' } },
        { city: { contains: q.q, mode: 'insensitive' } },
        { profession: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return withTenant(schoolId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.alumni.findMany({
          where,
          orderBy: [{ batchYear: 'desc' }, { lastName: 'asc' }],
          take,
          skip,
          select: {
            id: true, firstName: true, lastName: true, batchYear: true, lastClass: true,
            admissionNo: true, city: true, country: true, profession: true, employer: true,
            email: true, phone: true, status: true, trustedForStudents: true,
            isBatchCaptain: true, isMentor: true, isDeceased: true, studentId: true,
            createdAt: true,
          },
        }),
        tx.alumni.count({ where }),
      ]);
      return { rows, total, take, skip };
    });
  }

  // ─── Graduation ────────────────────────────────────────────────────────────

  /**
   * The forward engine: every March a batch leaves, and this is the button that
   * stops the school losing it. Reads the leaving sections and writes one Alumni
   * row per child, carrying the admission number, the class and the photograph.
   *
   * Idempotent by `@@unique([schoolId, studentId])` and `skipDuplicates`, so a
   * clerk who presses it twice — or who adds a second section a week later and
   * presses it again — gets the batch once, not twice. That mattered enough to
   * be the reason `studentId` is unique rather than merely indexed.
   */
  async graduateBatch(schoolId: string, dto: GraduateBatchDto) {
    if (dto.classSectionIds.length === 0) {
      throw new ApiError('NOTHING_TO_GRADUATE', 'Choose at least one class section.', 400);
    }
    return withTenant(schoolId, async (tx) => {
      // schoolId in the WHERE as well as RLS: the policy is the backstop, an
      // explicit scope is the intent. Every other service here does the same.
      const sections = await tx.classSection.findMany({
        where: { id: { in: dto.classSectionIds }, schoolId },
        select: { id: true, name: true, grade: { select: { name: true } } },
      });
      if (sections.length !== dto.classSectionIds.length) {
        throw new ApiError('CLASS_NOT_FOUND', 'One of those classes is not in this school.', 404);
      }
      const label = new Map(
        sections.map((s) => [s.id, s.grade ? `${s.grade.name} – ${s.name}` : s.name]),
      );

      const students = await tx.student.findMany({
        where: { schoolId, classSectionId: { in: dto.classSectionIds }, isActive: true },
        select: {
          id: true, admissionNo: true, firstName: true, lastName: true, email: true,
          guardianPhone: true, photoAssetId: true, classSectionId: true,
        },
      });

      const rows = toGraduationRows(
        students.map((s) => ({
          id: s.id,
          admissionNo: s.admissionNo,
          firstName: s.firstName,
          lastName: s.lastName,
          email: s.email,
          guardianPhone: s.guardianPhone,
          className: s.classSectionId ? (label.get(s.classSectionId) ?? null) : null,
          photoAssetId: s.photoAssetId,
        })),
        dto.batchYear,
      );

      const created = await tx.alumni.createMany({
        data: rows.map((r) => ({
          schoolId,
          studentId: r.studentId,
          admissionNo: r.admissionNo,
          firstName: r.firstName,
          lastName: r.lastName,
          batchYear: r.batchYear,
          lastClass: r.lastClass,
          email: r.email,
          photoAssetId: r.photoAssetId,
          // r.guardianPhoneForInvite is deliberately NOT written to `phone`.
          // See toGraduationRows — it belongs to a parent, and a school that
          // copies it spends the next four years messaging fathers.
          status: 'SCHOOL_ADDED' as const,
          privacy: defaultPrivacy(),
        })),
        skipDuplicates: true,
      });

      // The register strength for a Sckools-graduated year is not a guess — it
      // is how many alumni rows that year actually has.
      //
      // It is DERIVED, never incremented. An increment double-counts the moment
      // anyone types a strength in by hand before graduating the batch (81 typed
      // from the bound register, then 81 graduated, reads as 162 and the Roll
      // Call bar shows 50% coverage of a year that is completely accounted for).
      // It must also never go DOWN: a pre-Sckools year legitimately carries a
      // strength far larger than the handful of alumni found so far.
      const actual = await tx.alumni.count({ where: { schoolId, batchYear: dto.batchYear } });
      const existing = await tx.alumniBatch.findUnique({
        where: { schoolId_batchYear: { schoolId, batchYear: dto.batchYear } },
        select: { registerStrength: true },
      });
      await tx.alumniBatch.upsert({
        where: { schoolId_batchYear: { schoolId, batchYear: dto.batchYear } },
        update: { registerStrength: Math.max(existing?.registerStrength ?? 0, actual) },
        create: { schoolId, batchYear: dto.batchYear, registerStrength: actual },
      });

      return {
        batchYear: dto.batchYear,
        considered: rows.length,
        created: created.count,
        alreadyPresent: rows.length - created.count,
        /** Surfaced so the invite screen can say "papa's number — is there one
         *  for you?" rather than silently messaging a parent. */
        guardianPhonesOnFile: rows.filter((r) => r.guardianPhoneForInvite).length,
      };
    });
  }

  // ─── Roll Call ─────────────────────────────────────────────────────────────

  async rollCall(schoolId: string): Promise<RollCallRow[]> {
    return withTenant(schoolId, async (tx) => {
      const [batches, grouped, verifiedGrouped, sckoolsGrouped] = await Promise.all([
        tx.alumniBatch.findMany({ where: { schoolId }, orderBy: { batchYear: 'desc' } }),
        tx.alumni.groupBy({ by: ['batchYear'], where: { schoolId }, _count: { _all: true } }),
        tx.alumni.groupBy({
          by: ['batchYear'],
          where: { schoolId, status: 'VERIFIED' },
          _count: { _all: true },
        }),
        tx.alumni.groupBy({
          by: ['batchYear'],
          where: { schoolId, studentId: { not: null } },
          _count: { _all: true },
        }),
      ]);

      const found = new Map(grouped.map((g) => [g.batchYear, g._count._all]));
      const verified = new Map(verifiedGrouped.map((g) => [g.batchYear, g._count._all]));
      const sckools = new Map(sckoolsGrouped.map((g) => [g.batchYear, g._count._all]));
      const strength = new Map(batches.map((b) => [b.batchYear, b.registerStrength]));

      // Union of both sides: a year can have a register strength typed in before
      // a single alumnus is found, and it must still show as a row to work on.
      const years = [...new Set([...found.keys(), ...strength.keys()])].sort((a, b) => b - a);

      return years.map((batchYear) => {
        const f = found.get(batchYear) ?? 0;
        const s = strength.get(batchYear) ?? 0;
        return {
          batchYear,
          found: f,
          verified: verified.get(batchYear) ?? 0,
          registerStrength: s,
          // A percentage with no denominator is a lie, so it is null and the UI
          // says "strength not recorded" rather than drawing a full bar.
          coverage: s > 0 ? Math.min(100, Math.round((f / s) * 100)) : null,
          fromSckools: f > 0 && (sckools.get(batchYear) ?? 0) === f,
        };
      });
    });
  }

  async saveBatchStrength(schoolId: string, dto: SaveBatchStrengthDto) {
    return withTenant(schoolId, (tx) =>
      tx.alumniBatch.upsert({
        where: { schoolId_batchYear: { schoolId, batchYear: dto.batchYear } },
        update: { registerStrength: dto.registerStrength, note: dto.note ?? null },
        create: {
          schoolId,
          batchYear: dto.batchYear,
          registerStrength: dto.registerStrength,
          note: dto.note ?? null,
        },
      }),
    );
  }

  // ─── Claims ────────────────────────────────────────────────────────────────

  async listClaims(schoolId: string, status?: string) {
    return withTenant(schoolId, (tx) =>
      tx.alumniClaim.findMany({
        where: { schoolId, ...(status ? { status: status as never } : {}) },
        // Vouched claims first: the office cannot personally recognise four
        // thousand faces from thirty years of registers, and a name attached to
        // a recommendation is the only thing that makes the queue tractable.
        orderBy: [{ vouchedByAlumniId: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 200,
      }),
    );
  }

  /**
   * Verify, decline, or merge. A claim NEVER becomes visible by ageing — the
   * only path out of PENDING is a human pressing a button, which is the whole
   * reason claims live in their own table rather than as unverified Alumni rows.
   */
  async decideClaim(schoolId: string, claimId: string, userId: string | null, dto: DecideClaimDto) {
    if (dto.action === 'DECLINE' && !dto.reason?.trim()) {
      throw new ApiError('REASON_REQUIRED', 'A declined claim owes the person a reason.', 400);
    }
    return withTenant(schoolId, async (tx) => {
      const claim = await tx.alumniClaim.findFirst({ where: { id: claimId, schoolId } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status !== 'PENDING') {
        throw new ApiError('CLAIM_ALREADY_DECIDED', 'That claim has already been decided.', 409);
      }

      if (dto.action === 'DECLINE') {
        return tx.alumniClaim.update({
          where: { id: claimId },
          data: {
            status: 'DECLINED',
            declineReason: dto.reason!.trim(),
            reviewedByUserId: userId,
            reviewedAt: new Date(),
          },
        });
      }

      // Merge into an existing row rather than creating a second one. The
      // duplicate is guaranteed, not hypothetical: the same person gets
      // imported from the register AND self-registers from the public page.
      if (dto.mergeIntoAlumniId) {
        const target = await tx.alumni.findFirst({
          where: { id: dto.mergeIntoAlumniId, schoolId },
        });
        if (!target) throw new NotFoundException('That alumni record is not in this school.');
        // A merge writes the claimant's contact details onto an existing person.
        // Get the person wrong and the school spends the next two years
        // messaging a stranger in the belief it is reaching an old pupil, with
        // nothing in the record to show it happened. A batch-year mismatch is
        // far more often a mis-click in a long list than a deliberate
        // correction, so it is refused rather than warned about.
        if (target.batchYear !== claim.batchYear) {
          throw new ApiError(
            'CLAIM_BATCH_MISMATCH',
            `That record is the Class of ${target.batchYear} and this claim says ${claim.batchYear}. Pick the right record, or verify the claim on its own and merge the two afterwards.`,
            409,
          );
        }
        const alreadyVerified = target.status === 'VERIFIED';
        await tx.alumni.update({
          where: { id: target.id },
          data: {
            status: 'VERIFIED',
            // Do not overwrite an existing verification. Whoever first matched
            // this person against the register is the answer to "who let them
            // in", and a later merge must not quietly take the credit or the
            // blame for it.
            verifiedByUserId: alreadyVerified ? target.verifiedByUserId : userId,
            verifiedAt: alreadyVerified ? target.verifiedAt : new Date(),
            // Fill blanks from the claim; never overwrite what the school holds.
            email: target.email ?? claim.email,
            phone: target.phone ?? claim.phone,
            admissionNo: target.admissionNo ?? claim.claimedAdmissionNo,
          },
        });
        return tx.alumniClaim.update({
          where: { id: claimId },
          data: {
            status: 'VERIFIED',
            matchedAlumniId: target.id,
            reviewedByUserId: userId,
            reviewedAt: new Date(),
          },
        });
      }

      const created = await tx.alumni.create({
        data: {
          schoolId,
          firstName: claim.firstName,
          lastName: claim.lastName,
          batchYear: claim.batchYear,
          admissionNo: claim.claimedAdmissionNo,
          email: claim.email,
          phone: claim.phone,
          status: 'VERIFIED',
          verifiedByUserId: userId,
          verifiedAt: new Date(),
          privacy: defaultPrivacy(),
        },
      });
      return tx.alumniClaim.update({
        where: { id: claimId },
        data: {
          status: 'VERIFIED',
          matchedAlumniId: created.id,
          reviewedByUserId: userId,
          reviewedAt: new Date(),
        },
      });
    });
  }

  // ─── Trust ─────────────────────────────────────────────────────────────────

  /**
   * The second decision, separate from `status`. Being a real alumnus gets you
   * the directory; it does not get you a room full of fourteen-year-olds.
   *
   * REVOKING CASCADES. Not "prevents new sessions" — it cancels the scheduled
   * ones, releases the periods and leaves a reason on each. A revocation that
   * leaves a booking standing next Tuesday is not a revocation, and this is the
   * single most important line in the module.
   */
  async setTrusted(schoolId: string, alumniId: string, userId: string | null, dto: SetTrustedDto) {
    return withTenant(schoolId, async (tx) => {
      const alum = await tx.alumni.findFirst({ where: { id: alumniId, schoolId } });
      if (!alum) throw new NotFoundException('Alumni record not found');
      if (dto.trusted && alum.status !== 'VERIFIED') {
        throw new ApiError(
          'MUST_BE_VERIFIED_FIRST',
          'Only a verified alumnus can be trusted with students.',
          409,
        );
      }

      await tx.alumni.update({
        where: { id: alumniId },
        data: { trustedForStudents: dto.trusted },
      });

      let cancelled = 0;
      if (!dto.trusted) {
        const res = await tx.guestSession.updateMany({
          where: { schoolId, alumniId, status: { in: ['REQUESTED', 'COUNTERED', 'SCHEDULED'] } },
          data: {
            status: 'CANCELLED',
            declineReason:
              dto.reason?.trim() ||
              'The school withdrew this speaker’s clearance to work with students.',
            decidedByUserId: userId,
            decidedAt: new Date(),
          },
        });
        cancelled = res.count;
      }
      return { trusted: dto.trusted, sessionsCancelled: cancelled };
    });
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  async summary(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [total, verified, pendingClaims, batches, cities, openPledges, openSessions] =
        await Promise.all([
          tx.alumni.count({ where: { schoolId } }),
          tx.alumni.count({ where: { schoolId, status: 'VERIFIED' } }),
          tx.alumniClaim.count({ where: { schoolId, status: 'PENDING' } }),
          tx.alumni.groupBy({ by: ['batchYear'], where: { schoolId } }),
          tx.alumni.groupBy({ by: ['city'], where: { schoolId, city: { not: null } } }),
          tx.giftPledge.count({ where: { schoolId, status: { in: ['PROPOSED', 'COUNTERED'] } } }),
          tx.guestSession.count({ where: { schoolId, status: 'REQUESTED' } }),
        ]);
      return {
        total,
        verified,
        pendingClaims,
        batches: batches.length,
        cities: cities.length,
        openPledges,
        openSessions,
      };
    });
  }
}
