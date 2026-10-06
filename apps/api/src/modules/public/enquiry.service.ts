import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { FeatureResolverService } from '../features';
import type { CreateDeskEnquiryDto, SubmitEnquiryDto } from './public.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import type { TenantTx } from '@skoolos/db';
import {
  ENQUIRY_SOURCE_LABEL, contactTarget, stageMove,
  type ContactKind, type ContactOutcome, type EnquiryDeskMember, type EnquiryStageValue,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isAdmissionsDesk } from './internal/admissions-desk.guard';

/** How a stage reads in a history line. */
const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', INTERESTED: 'Interested', VISITED: 'Visited',
  APPLIED: 'Applied', ENROLLED: 'Enrolled', LOST: 'Lost', CLOSED: 'Closed',
};

/** Who did something. `name` absent = the service looks it up; present (even null) = use it. */
type Actor = { userId?: string; name?: string | null };

/** The first words of a contact's history line. */
const CONTACT_WORD: Record<ContactKind, string> = {
  CALL: 'Called',
  WHATSAPP: 'Messaged on WhatsApp',
  VISIT: 'Visited the school',
};
/** What came of it, appended. CONTACTED needs no words — "Called" already says it. */
const OUTCOME_WORD: Record<ContactOutcome, string> = {
  CONTACTED: '',
  INTERESTED: ' — interested',
  NO_ANSWER: ' — no answer',
  LOST: ' — not going ahead',
};

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
          parentName: dto.parentName.trim(),
          phone: dto.phone.trim(),
          email: dto.email,
          gradeInterest: dto.gradeInterest,
          message: dto.message,
          source: dto.source ?? 'WEBSITE',
          status: 'NEW',
        },
      }).then(async (row) => {
        // The history starts where the lead did. Without this the timeline of a
        // brand-new enquiry is empty, which reads as "nothing has happened
        // here" rather than "this has just arrived".
        const opening = dto.source === 'COURSE_CARD'
          ? 'Call-back requested from a course card'
          : 'Enquiry received from the website';
        await tx.enquiryNote.create({
          data: {
            schoolId,
            enquiryId: row.id,
            kind: 'SYSTEM',
            body: dto.gradeInterest ? `${opening} — asked about ${dto.gradeInterest}` : opening,
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
          dto.status === 'CLOSED'
            ? 'Closed is no longer used — mark the lead Lost instead.'
            : `A lead only moves forward — this one is at ${STAGE_LABEL[existing.status] ?? existing.status}. Mark it lost, or reopen a lost one.`,
          409,
          'status',
        );
      }

      // Lost needs a reason, here as well as in the UI. Checked before any write.
      const lostNow = (dto.status ?? existing.status) === 'LOST';
      const reason = typeof dto.lostReason === 'string' ? dto.lostReason.trim() : dto.lostReason;
      if (lostNow && ((move === 'LOSE' && !reason) || (dto.lostReason !== undefined && !reason))) {
        throw new ApiError('ENQUIRY_LOST_REASON_REQUIRED', 'Say why this lead was lost.', 400, 'lostReason');
      }

      // A client-supplied id: FK checks bypass RLS, and this is not even an FK.
      // Checked only when it CHANGES, so a lead whose owner has left can still
      // have its callback moved.
      if (dto.ownerUserId && dto.ownerUserId !== existing.ownerUserId && !(await isAdmissionsDesk(tx, schoolId, dto.ownerUserId))) {
        throw new ApiError('ENQUIRY_OWNER_NOT_DESK', 'A lead can only be given to an admissions officer or a school admin.', 400, 'ownerUserId');
      }

      const stageChanges = dto.status !== undefined && move !== 'SAME';
      const data: Record<string, unknown> = {};
      // Only a real move writes the stage: echoing the stage a lead already has
      // must not overwrite another desk's concurrent move.
      if (stageChanges) data.status = dto.status;
      if (dto.followUpAt !== undefined) {
        data.followUpAt = dto.followUpAt ? new Date(dto.followUpAt) : null;
      }
      if (dto.ownerUserId !== undefined) data.ownerUserId = dto.ownerUserId;
      if (dto.lostReason !== undefined) data.lostReason = reason;

      const terminal = dto.status === 'ENROLLED' || dto.status === 'LOST';
      if (terminal) data.followUpAt = null;
      // A reason belongs to being lost. Moving back out of LOST drops it rather
      // than leaving a stale explanation attached to a live lead.
      if (stageChanges && dto.status !== 'LOST' && dto.lostReason === undefined) {
        data.lostReason = null;
      }

      const reasonChanged = lostNow && !stageChanges && !!reason && reason !== (existing.lostReason ?? '').trim();

      let updated: Awaited<ReturnType<typeof tx.enquiry.update>>;
      if (stageChanges || dto.lostReason !== undefined) {
        // Compare-and-set on the stage we judged against — for a move, and for a
        // lost reason (it only means something while the lead is still LOST). Under READ
        // COMMITTED two desks could both pass "forward" from the same stage and
        // the last commit would win, moving the lead backwards.
        const { count } = await tx.enquiry.updateMany({ where: { id, schoolId, status: existing.status }, data });
        if (count === 0) {
          throw new ApiError('ENQUIRY_CHANGED', 'Someone else just moved this lead. Refresh and try again.', 409, 'status');
        }
        updated = (await tx.enquiry.findFirst({ where: { id, schoolId } })) ?? ({ ...existing, ...data } as typeof existing);
      } else {
        updated = await tx.enquiry.update({ where: { id }, data });
      }

      if (stageChanges || reasonChanged) {
        const by = await this.author(tx, schoolId, actor);
        const body = reasonChanged
          ? `Lost reason changed — ${reason}`
          : dto.status === 'LOST'
            ? `Marked Lost — ${reason}`
            : move === 'REOPEN'
              ? 'Reopened — back to Contacted'
              : `Moved to ${STAGE_LABEL[dto.status as string] ?? dto.status}`;
        await tx.enquiryNote.create({
          data: { schoolId, enquiryId: id, kind: 'STAGE', body, authorUserId: by.userId, authorName: by.name },
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
      if (!body.trim()) throw new ApiError('VALIDATION', 'Write something in the note first.', 400, 'body');
      const by = await this.author(tx, schoolId, actor);
      return tx.enquiryNote.create({
        data: { schoolId, enquiryId: id, kind: 'NOTE', body, authorUserId: by.userId, authorName: by.name },
      });
    });
  }

  /**
   * Somebody reached the family — or tried to.
   *
   * The contact line, the stamp and the stage move share one transaction, the
   * same rule as `update`'s STAGE note. `contactTarget` decides the stage: a
   * first contact moves NEW → CONTACTED, Interested moves forward to
   * INTERESTED, Lost loses it, and "no answer" moves nothing — a call that rang
   * out did not contact anybody. Any attempt stamps `lastContactedAt`.
   *
   * A stage move is a compare-and-set on the stage we judged against, exactly
   * as in `update`: a contact logged against a lead another officer has just
   * moved is refused 409 ENQUIRY_CHANGED rather than overwriting that move.
   * Losing a lead needs a reason here too (400 ENQUIRY_LOST_REASON_REQUIRED),
   * checked before anything is written.
   *
   * Tier B's WhatsApp buttons ("Contacted", "Interested", "Not interested")
   * call exactly this, so the desk and the phone agree.
   */
  async logContact(
    schoolId: string,
    id: string,
    kind: ContactKind,
    opts: { outcome?: ContactOutcome; lostReason?: string | null; body?: string } = {},
    actor?: Actor,
  ) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');

      const target = contactTarget(existing.status as EnquiryStageValue, opts.outcome);
      const reason = opts.lostReason?.trim() || null;
      if (target === 'LOST' && !reason) {
        throw new ApiError('ENQUIRY_LOST_REASON_REQUIRED', 'Say why this lead was lost.', 400, 'lostReason');
      }

      const data: Record<string, unknown> = { lastContactedAt: new Date() };
      if (target) data.status = target;
      if (target === 'LOST') {
        data.lostReason = reason;
        data.followUpAt = null;
      }
      if (target) {
        const { count } = await tx.enquiry.updateMany({ where: { id, schoolId, status: existing.status }, data });
        if (count === 0) {
          throw new ApiError('ENQUIRY_CHANGED', 'Someone else just moved this lead. Refresh and try again.', 409, 'status');
        }
      } else {
        await tx.enquiry.updateMany({ where: { id, schoolId }, data });
      }

      const by = await this.author(tx, schoolId, actor);
      const extra = opts.body?.trim();
      const note = await tx.enquiryNote.create({
        data: {
          schoolId,
          enquiryId: id,
          kind,
          body: `${CONTACT_WORD[kind]}${opts.outcome ? OUTCOME_WORD[opts.outcome] : ''}${extra ? `: ${extra}` : ''}`,
          authorUserId: by.userId,
          authorName: by.name,
        },
      });
      if (target) {
        await tx.enquiryNote.create({
          data: {
            schoolId,
            enquiryId: id,
            kind: 'STAGE',
            body: target === 'LOST' ? `Marked Lost — ${reason}` : `Moved to ${STAGE_LABEL[target] ?? target}`,
            authorUserId: by.userId,
            authorName: by.name,
          },
        });
      }
      return note;
    });
  }

  /**
   * A walk-in or a phone enquiry typed at the desk. Owned by whoever typed it —
   * they are the one who met the family — and never throttled: the 5-a-minute
   * limit exists for strangers on the internet, and the office is not one.
   */
  async create(schoolId: string, dto: CreateDeskEnquiryDto, actor?: Actor) {
    return withTenant(schoolId, async (tx) => {
      const by = await this.author(tx, schoolId, actor);
      const grade = dto.gradeInterest?.trim() || null;
      const row = await tx.enquiry.create({
        data: {
          schoolId,
          parentName: dto.parentName.trim(),
          phone: dto.phone.trim(),
          email: dto.email ?? null,
          childName: dto.childName?.trim() || null,
          gradeInterest: grade,
          message: dto.message?.trim() || null,
          source: dto.source,
          whatsappOk: dto.whatsappOk ?? false,
          status: 'NEW',
          ownerUserId: by.userId,
        },
      });
      await tx.enquiryNote.create({
        data: {
          schoolId,
          enquiryId: row.id,
          kind: 'SYSTEM',
          body: `${ENQUIRY_SOURCE_LABEL[dto.source]} enquiry taken by ${by.name ?? 'the office'}${grade ? ` — asked about ${grade}` : ''}`,
          authorUserId: by.userId,
          authorName: by.name,
        },
      });
      return row;
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
