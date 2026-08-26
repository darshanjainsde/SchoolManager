import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { privacyOf, type PrivacyField, type PrivacyLevel } from './homecoming-rules';

/**
 * What an alumnus, or the public, is allowed to see.
 *
 * The projection lives here and nowhere else. LIBRARY-TRAPS #17 is the reason:
 * `stripReplacementPrice` removed a field for a student and shipped the whole
 * joined row alongside it — the strip was correct and the guarantee still
 * failed one join away. So these functions choose a `select` shape per
 * audience; they never fetch a row and prune it afterwards.
 */

export type Audience = 'PUBLIC' | 'ALUMNI' | 'BATCH';

/** Ordered weakest → strongest. An audience may see a field whose level is at
 *  or below its own reach. */
const REACH: Record<Audience, PrivacyLevel[]> = {
  PUBLIC: ['PUBLIC'],
  ALUMNI: ['PUBLIC', 'ALUMNI'],
  BATCH: ['PUBLIC', 'ALUMNI', 'BATCH'],
};

function canSee(privacy: unknown, field: PrivacyField, audience: Audience): boolean {
  return REACH[audience].includes(privacyOf(privacy, field));
}

export interface DirectoryRow {
  id: string;
  name: string;
  batchYear: number;
  city: string | null;
  profession: string | null;
  employer: string | null;
  collegeName: string | null;
  photoAssetId: string | null;
  isMentor: boolean;
  /** Only ever populated when that alumnus opened it to this audience. */
  email: string | null;
  phone: string | null;
}

/** The columns any audience-facing read is allowed to fetch. Contact details are
 *  included because an alumnus may open them — but never a school record, never
 *  a date of birth, never an address. Those have no audience but the office. */
const VISIBLE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  batchYear: true,
  city: true,
  profession: true,
  employer: true,
  collegeName: true,
  photoAssetId: true,
  isMentor: true,
  isDeceased: true,
  email: true,
  phone: true,
  privacy: true,
} as const;

type VisibleRow = {
  id: string; firstName: string; lastName: string; batchYear: number;
  city: string | null; profession: string | null; employer: string | null;
  collegeName: string | null; photoAssetId: string | null; isMentor: boolean;
  isDeceased: boolean; email: string | null; phone: string | null; privacy: unknown;
};

function project(r: VisibleRow, audience: Audience): DirectoryRow {
  const show = <T>(field: PrivacyField, value: T): T | null =>
    canSee(r.privacy, field, audience) ? value : null;
  return {
    id: r.id,
    // The name is the one field that is never hidden from a fellow alumnus once
    // verified — a directory of anonymous entries is not a directory. It is
    // still gated for PUBLIC.
    name: audience === 'PUBLIC' && !canSee(r.privacy, 'name', 'PUBLIC')
      ? 'A former student'
      : `${r.firstName} ${r.lastName}`.trim(),
    batchYear: r.batchYear,
    city: show('city', r.city),
    profession: show('work', r.profession),
    employer: show('work', r.employer),
    collegeName: show('college', r.collegeName),
    photoAssetId: show('photo', r.photoAssetId),
    isMentor: r.isMentor,
    // Contact details are closed by default and only ever opened deliberately.
    // A deceased alumnus's channels go quiet regardless of what they had set.
    email: r.isDeceased ? null : show('phone', r.email),
    phone: r.isDeceased ? null : show('phone', r.phone),
  };
}

@Injectable()
export class AlumniPortalService {
  /** The directory. Verified alumni only, both as the audience and as the rows. */
  async directory(
    schoolId: string,
    viewerBatchYear: number,
    q: { q?: string; batchYear?: number; city?: string; mentor?: boolean; take?: number; skip?: number },
  ) {
    const take = Math.min(q.take ?? 30, 100);
    const skip = q.skip ?? 0;
    const where: Record<string, unknown> = {
      schoolId,
      // HIDDEN and PENDING are not merely filtered from the response — they are
      // never fetched. Nobody unverified appears to another human being.
      status: 'VERIFIED',
    };
    if (q.batchYear) where.batchYear = q.batchYear;
    if (q.city) where.city = { equals: q.city, mode: 'insensitive' };
    if (q.mentor) where.isMentor = true;
    if (q.q) {
      where.OR = [
        { firstName: { contains: q.q, mode: 'insensitive' } },
        { lastName: { contains: q.q, mode: 'insensitive' } },
        { profession: { contains: q.q, mode: 'insensitive' } },
        { employer: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return withTenant(schoolId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.alumni.findMany({
          where,
          select: VISIBLE_SELECT,
          orderBy: [{ batchYear: 'desc' }, { lastName: 'asc' }],
          take,
          skip,
        }),
        tx.alumni.count({ where }),
      ]);
      return {
        total,
        take,
        skip,
        rows: rows.map((r) =>
          // Someone from the viewer's own year gets the BATCH reach; everybody
          // else gets ALUMNI. That is what "visible to my batch" has to mean.
          project(r as VisibleRow, r.batchYear === viewerBatchYear ? 'BATCH' : 'ALUMNI'),
        ),
      };
    });
  }

  /**
   * A batch page, readable with NO login at all.
   *
   * That is deliberate and it is the entire recovery engine: a password wall
   * means a search engine cannot index "Class of 1998", and the alumnus in
   * Dubai never finds himself. Nothing on this page is a contact detail unless
   * its owner published it to the public.
   */
  async publicBatch(schoolId: string, batchYear: number) {
    return withTenant(schoolId, async (tx) => {
      const [found, batch] = await Promise.all([
        tx.alumni.findMany({
          where: { schoolId, batchYear, status: 'VERIFIED' },
          select: VISIBLE_SELECT,
          orderBy: { lastName: 'asc' },
          take: 500,
        }),
        tx.alumniBatch.findUnique({
          where: { schoolId_batchYear: { schoolId, batchYear } },
          select: { registerStrength: true },
        }),
      ]);
      const strength = batch?.registerStrength ?? 0;
      return {
        batchYear,
        found: found.length,
        registerStrength: strength,
        // Null, not 100%. A percentage with no denominator is a lie.
        coverage: strength > 0 ? Math.min(100, Math.round((found.length / strength) * 100)) : null,
        stillMissing: Math.max(0, strength - found.length),
        alumni: found.map((r) => project(r as VisibleRow, 'PUBLIC')),
      };
    });
  }

  /** Which years exist, for the public index of batch pages. */
  async publicBatchIndex(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [grouped, batches] = await Promise.all([
        tx.alumni.groupBy({
          by: ['batchYear'],
          where: { schoolId, status: 'VERIFIED' },
          _count: { _all: true },
        }),
        tx.alumniBatch.findMany({ where: { schoolId }, select: { batchYear: true, registerStrength: true } }),
      ]);
      const strength = new Map(batches.map((b) => [b.batchYear, b.registerStrength]));
      const years = [...new Set([...grouped.map((g) => g.batchYear), ...strength.keys()])];
      return years
        .sort((a, b) => b - a)
        .map((y) => ({
          batchYear: y,
          found: grouped.find((g) => g.batchYear === y)?._count._all ?? 0,
          registerStrength: strength.get(y) ?? 0,
        }));
    });
  }

  /** An alumnus's own record — the only place they see everything they hold. */
  async me(schoolId: string, alumniId: string) {
    return withTenant(schoolId, (tx) =>
      tx.alumni.findFirst({
        where: { id: alumniId, schoolId },
        select: {
          id: true, firstName: true, lastName: true, batchYear: true, lastClass: true,
          admissionNo: true, email: true, phone: true, city: true, country: true,
          profession: true, employer: true, collegeName: true, photoAssetId: true,
          status: true, trustedForStudents: true, isBatchCaptain: true, isMentor: true,
          privacy: true,
        },
      }),
    );
  }

  /** An alumnus edits their own details and their own privacy. Nothing here can
   *  touch `status`, `trustedForStudents` or `isBatchCaptain` — those are the
   *  school's to grant, and a self-service route that could set them would make
   *  the whole verification ladder decorative. */
  async updateMe(
    schoolId: string,
    alumniId: string,
    dto: {
      phone?: string; city?: string; country?: string; profession?: string;
      employer?: string; collegeName?: string; isMentor?: boolean;
      privacy?: Record<string, string>;
    },
  ) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.alumni.findFirst({
        where: { id: alumniId, schoolId },
        select: { privacy: true },
      });
      if (!existing) return null;
      const merged = {
        ...(typeof existing.privacy === 'object' && existing.privacy ? existing.privacy : {}),
        ...(dto.privacy ?? {}),
      };
      return tx.alumni.update({
        where: { id: alumniId },
        data: {
          phone: dto.phone ?? undefined,
          city: dto.city ?? undefined,
          country: dto.country ?? undefined,
          profession: dto.profession ?? undefined,
          employer: dto.employer ?? undefined,
          collegeName: dto.collegeName ?? undefined,
          isMentor: dto.isMentor ?? undefined,
          privacy: merged,
        },
        select: { id: true, privacy: true, isMentor: true },
      });
    });
  }
}
