import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { FeatureResolverService } from '../features';
import type { SubmitEnquiryDto } from './public.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import type { EnquiryStatus } from '@skoolos/db';

/** How a stage reads in a history line. */
const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', VISITED: 'Visited',
  APPLIED: 'Applied', ENROLLED: 'Enrolled', LOST: 'Lost', CLOSED: 'Closed',
};

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
      const owners = ownerIds.length
        ? await tx.staff.findMany({ take: LIST_CEILING.ROSTER,
            where: { schoolId, userId: { in: ownerIds } },
            select: { userId: true, firstName: true, lastName: true },
          })
        : [];
      const byUser = new Map(owners.map((o) => [o.userId, `${o.firstName} ${o.lastName}`.trim()]));

      const counts = await tx.enquiryNote.groupBy({
        by: ['enquiryId'],
        where: { schoolId, kind: 'NOTE' },
        _count: { _all: true },
      });
      const noteCount = new Map(counts.map((c) => [c.enquiryId, c._count._all]));

      return rows.map((r) => ({
        ...r,
        ownerName: r.ownerUserId ? (byUser.get(r.ownerUserId) ?? null) : null,
        noteCount: noteCount.get(r.id) ?? 0,
      }));
    });
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
      let ownerName: string | null = null;
      if (enquiry.ownerUserId) {
        const staff = await tx.staff.findFirst({
          where: { schoolId, userId: enquiry.ownerUserId },
          select: { firstName: true, lastName: true },
        });
        ownerName = staff ? `${staff.firstName} ${staff.lastName}`.trim() : null;
      }
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
      status?: EnquiryStatus;
      followUpAt?: string | null;
      ownerUserId?: string | null;
      lostReason?: string | null;
    },
    actor?: { userId?: string; name?: string | null },
  ) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');

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

      if (dto.status !== undefined && dto.status !== existing.status) {
        await tx.enquiryNote.create({
          data: {
            schoolId,
            enquiryId: id,
            kind: 'STAGE',
            body:
              dto.status === 'LOST' && updated.lostReason
                ? `Marked Lost — ${updated.lostReason}`
                : `Moved to ${STAGE_LABEL[dto.status] ?? dto.status}`,
            authorUserId: actor?.userId ?? null,
            authorName: actor?.name ?? null,
          },
        });
      }

      return updated;
    });
  }

  /** A note somebody typed. What makes "Contacted" checkable. */
  async addNote(
    schoolId: string,
    id: string,
    body: string,
    actor?: { userId?: string; name?: string | null },
  ) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');
      return tx.enquiryNote.create({
        data: {
          schoolId,
          enquiryId: id,
          kind: 'NOTE',
          body,
          authorUserId: actor?.userId ?? null,
          authorName: actor?.name ?? null,
        },
      });
    });
  }
}
