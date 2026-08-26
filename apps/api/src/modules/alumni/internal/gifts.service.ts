import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { amountForMode, assertScopeShape, giftShortfall, nextGiftStatus } from './homecoming-rules';
import type {
  CreatePledgeDto,
  DecidePledgeDto,
  DistributeGiftDto,
  ReceiveGiftDto,
  SaveGiftItemDto,
} from './alumni.dto';

@Injectable()
export class GiftsService {
  // ─── Catalogue ─────────────────────────────────────────────────────────────

  /** Written by the school, never by us and never by a donor. The worst outcome
   *  this feature can produce is three hundred unwanted T-shirts nobody can
   *  refuse politely, and an open catalogue is how that happens. */
  listItems(schoolId: string, includeInactive = false) {
    return withTenant(schoolId, (tx) =>
      tx.giftItem.findMany({
        where: { schoolId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  saveItem(schoolId: string, id: string | null, dto: SaveGiftItemDto) {
    const data = {
      name: dto.name.trim(),
      unit: dto.unit?.trim() || 'per child',
      indicativeCostMinor: dto.indicativeCostMinor ?? 0,
      sizesTracked: dto.sizesTracked ?? false,
      isActive: dto.isActive ?? true,
      order: dto.order ?? 0,
    };
    return withTenant(schoolId, async (tx) => {
      if (id) {
        const existing = await tx.giftItem.findFirst({ where: { id, schoolId } });
        if (!existing) throw new NotFoundException('Gift item not found');
        return tx.giftItem.update({ where: { id }, data });
      }
      return tx.giftItem.create({ data: { ...data, schoolId } });
    });
  }

  // ─── The roster panel ──────────────────────────────────────────────────────

  /**
   * Counts, never children. This is the only thing a donor is ever shown about
   * the people they are giving to — a number per group, and (where the school
   * has recorded them) a size tally. No name, no photograph, no fee status, and
   * no "students in need" list to browse.
   */
  async groups(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [sections, wholeSchool] = await Promise.all([
        tx.classSection.findMany({
          where: { schoolId },
          select: {
            id: true,
            name: true,
            gradeId: true,
            grade: { select: { id: true, name: true, order: true } },
            _count: { select: { students: { where: { isActive: true } } } },
          },
          orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
        }),
        tx.student.count({ where: { schoolId, isActive: true } }),
      ]);

      const byGrade = new Map<string, { id: string; name: string; order: number; n: number }>();
      for (const s of sections) {
        if (!s.grade) continue;
        const g = byGrade.get(s.grade.id) ?? { id: s.grade.id, name: s.grade.name, order: s.grade.order, n: 0 };
        g.n += s._count.students;
        byGrade.set(s.grade.id, g);
      }

      return {
        school: { scopeKind: 'SCHOOL' as const, label: 'Whole school', headcount: wholeSchool },
        grades: [...byGrade.values()]
          .sort((a, b) => a.order - b.order)
          .map((g) => ({ scopeKind: 'GRADE' as const, gradeId: g.id, label: g.name, headcount: g.n })),
        sections: sections.map((s) => ({
          scopeKind: 'SECTION' as const,
          classSectionId: s.id,
          gradeId: s.gradeId,
          label: s.grade ? `${s.grade.name} – ${s.name}` : s.name,
          headcount: s._count.students,
        })),
      };
    });
  }

  /** Resolved server-side. The donor never sends a headcount and never sends a
   *  quantity — otherwise the "everyone in the group" rule is advisory. */
  private async resolveHeadcount(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    schoolId: string,
    dto: CreatePledgeDto,
  ): Promise<number> {
    if (dto.scopeKind === 'SCHOOL') {
      return tx.student.count({ where: { schoolId, isActive: true } });
    }
    if (dto.scopeKind === 'GRADE') {
      const grade = await tx.grade.findFirst({ where: { id: dto.gradeId!, schoolId } });
      if (!grade) throw new NotFoundException('That class is not in this school.');
      return tx.student.count({
        where: { schoolId, isActive: true, classSection: { gradeId: dto.gradeId! } },
      });
    }
    const section = await tx.classSection.findFirst({
      where: { id: dto.classSectionId!, schoolId },
    });
    if (!section) throw new NotFoundException('That class is not in this school.');
    return tx.student.count({ where: { schoolId, isActive: true, classSectionId: dto.classSectionId! } });
  }

  // ─── Pledges ───────────────────────────────────────────────────────────────

  async createPledge(schoolId: string, dto: CreatePledgeDto) {
    try {
      assertScopeShape(dto.scopeKind, dto.gradeId, dto.classSectionId);
    } catch (e) {
      throw new ApiError('BAD_GIFT_SCOPE', (e as Error).message, 400);
    }
    if (!dto.alumniId && !dto.donorName?.trim()) {
      throw new ApiError('DONOR_REQUIRED', 'A pledge needs an alumnus or a donor name.', 400);
    }
    if (!dto.giftItemId && !dto.customRequest?.trim()) {
      throw new ApiError('GIFT_REQUIRED', 'Choose something from the list, or describe it.', 400);
    }

    return withTenant(schoolId, async (tx) => {
      if (dto.alumniId) {
        const alum = await tx.alumni.findFirst({ where: { id: dto.alumniId, schoolId } });
        if (!alum) throw new NotFoundException('Alumni record not found');
      }
      let unitCost = 0;
      if (dto.giftItemId) {
        const item = await tx.giftItem.findFirst({ where: { id: dto.giftItemId, schoolId } });
        if (!item) throw new NotFoundException('That is not on this school’s list.');
        if (!item.isActive) {
          throw new ApiError('GIFT_ITEM_INACTIVE', 'The school is no longer asking for that.', 409);
        }
        unitCost = item.indicativeCostMinor;
      }

      const headcount = await this.resolveHeadcount(tx, schoolId, dto);
      if (headcount === 0) {
        throw new ApiError('EMPTY_GROUP', 'There are no children in that group right now.', 409);
      }

      return tx.giftPledge.create({
        data: {
          schoolId,
          alumniId: dto.alumniId ?? null,
          donorName: dto.donorName?.trim() ?? null,
          donorEmail: dto.donorEmail ?? null,
          scopeKind: dto.scopeKind,
          gradeId: dto.gradeId ?? null,
          classSectionId: dto.classSectionId ?? null,
          // Frozen. A pledge for 38 sweaters must not silently become 41
          // because three children joined in July — the donor agreed to a
          // number and that number is the agreement.
          headcountAtPledge: headcount,
          // Quantity IS the headcount. Not a field the donor can set: a class
          // of 38 with 20 sweaters is a worse place than one with none.
          quantity: headcount,
          giftItemId: dto.giftItemId ?? null,
          customRequest: dto.customRequest?.trim() ?? null,
          mode: dto.mode,
          // null for SUPPLY — an in-kind gift carries no valuation, which is
          // what keeps donated goods out of the fee ledger.
          amountMinor: amountForMode(dto.mode, unitCost, headcount),
          dedicationKind: dto.dedicationKind ?? 'NONE',
          dedicationText: dto.dedicationText?.trim() || null,
          visibility: dto.visibility ?? 'ALUMNI',
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          status: 'PROPOSED',
        },
      });
    });
  }

  async listPledges(schoolId: string, status?: string) {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.giftPledge.findMany({
        where: { schoolId, ...(status ? { status: status as never } : {}) },
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
        include: {
          giftItem: { select: { name: true, unit: true, sizesTracked: true } },
          alumni: { select: { firstName: true, lastName: true, batchYear: true } },
          receipts: { select: { receivedQty: true } },
          distributions: { select: { distributedQty: true, absentQty: true, distributedAt: true } },
        },
      });
      return rows.map((p) => {
        const received = p.receipts.reduce((n, r) => n + r.receivedQty, 0);
        return { ...p, ...giftShortfall(p.quantity, received) };
      });
    });
  }

  /** An alumnus's own pledges. Scoped by alumniId as well as school, so the
   *  route cannot be turned into "list everybody's gifts" by omitting a filter. */
  async listPledgesForAlumnus(schoolId: string, alumniId: string) {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.giftPledge.findMany({
        where: { schoolId, alumniId },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
        include: {
          giftItem: { select: { name: true, unit: true, sizesTracked: true } },
          receipts: { select: { receivedQty: true } },
          distributions: { select: { distributedQty: true, absentQty: true, distributedAt: true } },
        },
      });
      return rows.map((p) => {
        const received = p.receipts.reduce((n, r) => n + r.receivedQty, 0);
        return { ...p, ...giftShortfall(p.quantity, received) };
      });
    });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async decide(schoolId: string, pledgeId: string, userId: string | null, dto: DecidePledgeDto) {
    if (dto.action === 'DECLINE' && !dto.reason?.trim()) {
      // A flat decline ends the conversation and the donor does not come back.
      // Requiring a reason is the cheapest way to make suggesting an
      // alternative the path of least resistance.
      throw new ApiError('REASON_REQUIRED', 'A declined gift owes the donor a reason.', 400);
    }
    if (dto.action === 'COUNTER' && !dto.counterNote?.trim()) {
      throw new ApiError('COUNTER_NOTE_REQUIRED', 'Say what the school needs instead.', 400);
    }
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({ where: { id: pledgeId, schoolId } });
      if (!pledge) throw new NotFoundException('Pledge not found');
      const next = nextGiftStatus(pledge.status, dto.action);
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          `A ${pledge.status.toLowerCase()} pledge cannot be ${dto.action.toLowerCase()}ed.`,
          409,
        );
      }
      return tx.giftPledge.update({
        where: { id: pledgeId },
        data: {
          status: next,
          declineReason: dto.action === 'DECLINE' ? dto.reason!.trim() : pledge.declineReason,
          counterNote: dto.action === 'COUNTER' ? dto.counterNote!.trim() : pledge.counterNote,
          acceptedByUserId: dto.action === 'ACCEPT' ? userId : pledge.acceptedByUserId,
          acceptedAt: dto.action === 'ACCEPT' ? new Date() : pledge.acceptedAt,
        },
      });
    });
  }

  /** What ACTUALLY arrived. Recorded as its own dated row rather than a column,
   *  so a short delivery topped up a fortnight later keeps both facts. */
  async receive(schoolId: string, pledgeId: string, userId: string | null, dto: ReceiveGiftDto) {
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({
        where: { id: pledgeId, schoolId },
        include: { receipts: { select: { receivedQty: true } } },
      });
      if (!pledge) throw new NotFoundException('Pledge not found');
      const next = nextGiftStatus(pledge.status, 'RECEIVE');
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          `Nothing can be received against a ${pledge.status.toLowerCase()} pledge.`,
          409,
        );
      }
      await tx.giftReceipt.create({
        data: {
          schoolId,
          pledgeId,
          receivedQty: dto.receivedQty,
          receivedByUserId: userId,
          note: dto.note?.trim() || null,
        },
      });
      await tx.giftPledge.update({ where: { id: pledgeId }, data: { status: next } });
      const received = pledge.receipts.reduce((n, r) => n + r.receivedQty, 0) + dto.receivedQty;
      return giftShortfall(pledge.quantity, received);
    });
  }

  /**
   * The rule the whole feature hangs on, enforced here and not merely displayed:
   * a gift covers everyone in the group it was given to, or it waits.
   */
  async distribute(schoolId: string, pledgeId: string, userId: string | null, dto: DistributeGiftDto) {
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({
        where: { id: pledgeId, schoolId },
        include: { receipts: { select: { receivedQty: true } } },
      });
      if (!pledge) throw new NotFoundException('Pledge not found');
      const next = nextGiftStatus(pledge.status, 'DISTRIBUTE');
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          `A ${pledge.status.toLowerCase()} pledge cannot be handed out.`,
          409,
        );
      }
      const received = pledge.receipts.reduce((n, r) => n + r.receivedQty, 0);
      const view = giftShortfall(pledge.quantity, received);
      if (!view.canDistribute) {
        throw new ApiError(
          'GIFT_SHORT',
          `Short by ${view.short}. This cannot be handed out until every child in the group has one — the pledge stays open so somebody can close it.`,
          409,
        );
      }
      // The two numbers must agree with the group. Handing out fewer than the
      // headcount, with the rest logged as "absent", is the same divided
      // classroom by another name unless the absent children are named as owed.
      if (dto.distributedQty + (dto.absentQty ?? 0) !== pledge.quantity) {
        throw new ApiError(
          'GIFT_COUNT_MISMATCH',
          `Given plus absent must equal ${pledge.quantity}. Children who were away are still owed theirs.`,
          400,
        );
      }
      await tx.giftDistribution.create({
        data: {
          schoolId,
          pledgeId,
          classSectionId: pledge.classSectionId,
          distributedQty: dto.distributedQty,
          absentQty: dto.absentQty ?? 0,
          byUserId: userId,
          note: dto.note?.trim() || null,
        },
      });
      return tx.giftPledge.update({ where: { id: pledgeId }, data: { status: next } });
    });
  }

  async report(schoolId: string, pledgeId: string) {
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({ where: { id: pledgeId, schoolId } });
      if (!pledge) throw new NotFoundException('Pledge not found');
      const next = nextGiftStatus(pledge.status, 'REPORT');
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          'Only a distributed gift can be reported back.',
          409,
        );
      }
      return tx.giftPledge.update({ where: { id: pledgeId }, data: { status: next } });
    });
  }
}
