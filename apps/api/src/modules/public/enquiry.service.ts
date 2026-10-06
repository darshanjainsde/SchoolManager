import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { FeatureResolverService } from '../features';
import type { SubmitEnquiryDto } from './public.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import type { TenantTx } from '@skoolos/db';
import { stageMove, type EnquiryDeskMember, type EnquiryStageValue } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isAdmissionsDesk } from './internal/admissions-desk.guard';

/** How a stage reads in a history line. */
const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', INTERESTED: 'Interested', VISITED: 'Visited',
  APPLIED: 'Applied', ENROLLED: 'Enrolled', LOST: 'Lost', CLOSED: 'Closed',
};

/** Who did something. `name` absent = the service looks it up; present (even null) = use it. */
type Actor = { userId?: string; name?: string | null };

/**
 * Display names for lead owners, from the same sources the desk picker uses:
 * the Staff record, else the name on the login, else "School admin" for an
 * admin who never typed one. An owner with no source at all is simply absent.
 * Not filtered by isActive — an owner who has left keeps their name on the lead.
 */
async function ownerNames(
  tx: Pick<TenantTx, 'staff' | 'user'>,
  schoolId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!userIds.length) return names;
  const staff = await tx.staff.findMany({ take: LIST_CEILING.ROSTER,
    where: { schoolId, userId: { in: userIds } },
    select: { userId: true, firstName: true, lastName: true },
  });
  for (const s of staff) {
    const full = `${s.firstName} ${s.lastName}`.trim();
    if (s.userId && full) names.set(s.userId, full);
  }
  const missing = userIds.filter((id) => !names.has(id));
  if (missing.length) {
    const users = await tx.user.findMany({ take: LIST_CEILING.ROSTER,
      where: { schoolId, id: { in: missing } },
      select: { id: true, name: true, role: true },
    });
    for (const u of users) {
      const name = u.name?.trim() || (u.role === 'SCHOOL_ADMIN' ? 'School admin' : '');
      if (name) names.set(u.id, name);
    }
  }
  return names;
}

/**
 * Who sits at the admissions desk: every active admissions officer with a
 * login, then every active school admin. The owner picker reads this, and so
 * does "Unowned" — a lead whose owner is not on this list is nobody's.
 */
export async function deskMembers(
  tx: Pick<TenantTx, 'staff' | 'user'>,
  schoolId: string,
): Promise<EnquiryDeskMember[]> {
  const officers = await tx.staff.findMany({
    where: { schoolId, role: 'ADMISSIONS', isActive: true, userId: { not: null } },
    select: { userId: true, firstName: true, lastName: true },
    orderBy: { firstName: 'asc' },
    take: LIST_CEILING.STRUCTURE,
  });
  const admins = await tx.user.findMany({
    where: { schoolId, role: 'SCHOOL_ADMIN', isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: 'asc' },
    take: LIST_CEILING.STRUCTURE,
  });
  return [
    ...officers.map((o) => ({
      userId: o.userId as string,
      name: `${o.firstName} ${o.lastName}`.trim(),
      job: 'ADMISSIONS' as const,
    })),
    ...admins.map((a) => ({ userId: a.id, name: a.name?.trim() || a.email, job: 'ADMIN' as const })),
  ];
}

@Injectable()
export class EnquiryService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly features: FeatureResolverService,
  ) {}

  async submit(dto: SubmitEnquiryDto) {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Site not found');
    const schoolId = ctx.schoolId;

    const feat = await this.features.getFeatures(schoolId);
    if (!feat.has('ENQUIRY')) throw new NotFoundException('Enquiry not available');

    return withTenant(schoolId, (tx) =>
      tx.enquiry.create({
        data: {
          schoolId,
          parentName: dto.parentName,
          phone: dto.phone,
          email: dto.email,
          gradeInterest: dto.gradeInterest,
          message: dto.message,
          status: 'NEW',
        },
      }).then(async (row) => {
        // The history starts where the lead did. Without this the timeline of a
        // brand-new enquiry is empty, which reads as "nothing has happened
        // here" rather than "this has just arrived".
        await tx.enquiryNote.create({
          data: {
            schoolId,
            enquiryId: row.id,
            kind: 'SYSTEM',
            body: dto.gradeInterest
              ? `Enquiry received from the website — asked about ${dto.gradeInterest}`
              : 'Enquiry received from the website',
          },
        });
        return row;
      }),
    );
  }

  /**
   * The desk's list.
   *
   * Ordered by CREATION for a stable, predictable payload; the client sorts by
   * urgency, because "who do I ring today" is a view of this data rather than a
   * different query, and re-sorting server-side would make the counts and the
   * list disagree while a mutation is in flight.
   *
   * The owner's name is resolved here rather than joined: `ownerUserId` is
   * deliberately not a relation, so that a lead keeps its history after the
   * member of staff who owned it has left.
   */
  async list(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.enquiry.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
      });

      const ownerIds = [...new Set(rows.map((r) => r.ownerUserId).filter((x): x is string => !!x))];
      const byUser = await ownerNames(tx, schoolId, ownerIds);

      const counts = await tx.enquiryNote.groupBy({
        by: ['enquiryId'],
        where: { schoolId, kind: 'NOTE' },
        _count: { _all: true },
      });
      const noteCount = new Map(counts.map((c) => [c.enquiryId, c._count._all]));

      const onDesk = new Set((await deskMembers(tx, schoolId)).map((m) => m.userId));

      return rows.map((r) => ({
        ...r,
        ownerName: r.ownerUserId ? (byUser.get(r.ownerUserId) ?? null) : null,
        // False for an owner who has left the desk — the desk shows the lead
        // under Unowned, while the name above keeps the history honest.
        ownerOnDesk: r.ownerUserId ? onDesk.has(r.ownerUserId) : false,
        noteCount: noteCount.get(r.id) ?? 0,
      }));
    });
  }

  /** The owner picker. Works on every plan — it reads no MANAGEMENT route. */
  async owners(schoolId: string): Promise<EnquiryDeskMember[]> {
    return withTenant(schoolId, (tx) => deskMembers(tx, schoolId));
  }

  /** One lead with its whole history — what the detail panel reads. */
  async detail(schoolId: string, id: string) {
    return withTenant(schoolId, async (tx) => {
      const enquiry = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!enquiry) throw new NotFoundException('Enquiry not found');
      const notes = await tx.enquiryNote.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, enquiryId: id },
        orderBy: { createdAt: 'desc' },
      });
      const ownerName = enquiry.ownerUserId
        ? ((await ownerNames(tx, schoolId, [enquiry.ownerUserId])).get(enquiry.ownerUserId) ?? null)
        : null;
      return { ...enquiry, ownerName, notes };
    });
  }

  /**
   * Update a lead, and record what changed.
   *
   * A stage change writes its own STAGE note in the SAME transaction as the
   * update: an audit line that can be absent when the change succeeded is
   * worse than none at all, because it makes the history look complete when it
   * is not.
   *
   * Reaching a terminal stage clears the follow-up date — a callback on an
   * enrolled family is a reminder to ring somebody about nothing, and it would
   * sit in the "overdue" count forever.
   */
  async update(
    schoolId: string,
    id: string,
    dto: {
      status?: EnquiryStageValue;
      followUpAt?: string | null;
      ownerUserId?: string | null;
      lostReason?: string | null;
    },
    actor?: Actor,
  ) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');

      const move = dto.status !== undefined ? stageMove(existing.status as EnquiryStageValue, dto.status) : 'SAME';
      if (move === 'BACKWARDS') {
        throw new ApiError(
          'ENQUIRY_STAGE_BACKWARDS',
          `A lead only moves forward — this one is at ${STAGE_LABEL[existing.status] ?? existing.status}. Mark it lost, or reopen a lost one.`,
          409,
          'status',
        );
      }
      // A client-supplied id: FK checks bypass RLS, and this is not even an FK.
      // Checked only when it CHANGES, so a lead whose owner has left can still
      // have its callback moved.
      if (dto.ownerUserId && dto.ownerUserId !== existing.ownerUserId && !(await isAdmissionsDesk(tx, schoolId, dto.ownerUserId))) {
        throw new ApiError('ENQUIRY_OWNER_NOT_DESK', 'A lead can only be given to an admissions officer or a school admin.', 400, 'ownerUserId');
      }

      const data: Record<string, unknown> = {};
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.followUpAt !== undefined) {
        data.followUpAt = dto.followUpAt ? new Date(dto.followUpAt) : null;
      }
      if (dto.ownerUserId !== undefined) data.ownerUserId = dto.ownerUserId;
      if (dto.lostReason !== undefined) data.lostReason = dto.lostReason;

      const terminal = dto.status === 'ENROLLED' || dto.status === 'LOST' || dto.status === 'CLOSED';
      if (terminal) data.followUpAt = null;
      // A reason belongs to being lost. Moving back out of LOST drops it rather
      // than leaving a stale explanation attached to a live lead.
      if (dto.status !== undefined && dto.status !== 'LOST' && dto.lostReason === undefined) {
        data.lostReason = null;
      }

      const updated = await tx.enquiry.update({ where: { id }, data });

      if (dto.status !== undefined && move !== 'SAME') {
        const by = await this.author(tx, schoolId, actor);
        await tx.enquiryNote.create({
          data: {
            schoolId,
            enquiryId: id,
            kind: 'STAGE',
            body:
              dto.status === 'LOST' && updated.lostReason
                ? `Marked Lost — ${updated.lostReason}`
                : move === 'REOPEN'
                  ? 'Reopened — back to Contacted'
                  : `Moved to ${STAGE_LABEL[dto.status] ?? dto.status}`,
            authorUserId: by.userId,
            authorName: by.name,
          },
        });
      }

      return updated;
    });
  }

  /** A note somebody typed. What makes "Contacted" checkable. */
  async addNote(schoolId: string, id: string, body: string, actor?: Actor) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');
      const by = await this.author(tx, schoolId, actor);
      return tx.enquiryNote.create({
        data: { schoolId, enquiryId: id, kind: 'NOTE', body, authorUserId: by.userId, authorName: by.name },
      });
    });
  }

  /**
   * The name a history line is signed with, read at write time and kept on
   * the row so it survives the person leaving. Staff and officers by their
   * staff record; an admin by the name on their profile, or "School admin" —
   * a line that says nobody wrote it is the defect this replaces.
   */
  private async author(
    tx: Pick<TenantTx, 'staff' | 'user'>,
    schoolId: string,
    actor?: Actor,
  ): Promise<{ userId: string | null; name: string | null }> {
    const userId = actor?.userId ?? null;
    if (actor && actor.name !== undefined) return { userId, name: actor.name };
    if (!userId) return { userId: null, name: null };
    const staff = await tx.staff.findFirst({ where: { schoolId, userId }, select: { firstName: true, lastName: true } });
    const full = staff ? `${staff.firstName} ${staff.lastName}`.trim() : '';
    if (full) return { userId, name: full };
    const user = await tx.user.findFirst({ where: { id: userId, schoolId }, select: { name: true, role: true } });
    return { userId, name: user?.name?.trim() || (user?.role === 'SCHOOL_ADMIN' ? 'School admin' : null) };
  }
}
