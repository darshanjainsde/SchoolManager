import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { StorageService } from '../../../common/storage/storage.service';
import {
  assertScopeShape,
  giftJourney,
  giftJourneyIndex,
  giftShortfall,
  giftStatusLabel,
  nextGiftStatus,
  priceForPledge,
  type GiftStatus,
} from './homecoming-rules';
import type {
  AttachGiftDto,
  CreatePledgeDto,
  DecidePledgeDto,
  DistributeGiftDto,
  MarkPickedUpDto,
  PurchaseGiftDto,
  ReceiveGiftDto,
  RequestPickupDto,
  SaveGiftItemDto,
  ThankYouDto,
} from './alumni.dto';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { studentCountsBySection } from '../../../common/lists/relation-counts';
import { assertUploadKind, IMAGE_OR_PDF_KINDS } from '../../../common/storage/upload-kind';

@Injectable()
export class GiftsService {
  // Explicit, not decorative: tsx does not reliably emit design:paramtypes, so
  // a bare-typed constructor parameter can resolve to undefined (LIBRARY-TRAPS
  // #6) — and an undefined storage client fails at upload time, in production,
  // rather than at boot.
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  // ─── Catalogue ─────────────────────────────────────────────────────────────

  /** Written by the school, never by us and never by a donor. The worst outcome
   *  this feature can produce is three hundred unwanted T-shirts nobody can
   *  refuse politely, and an open catalogue is how that happens. */
  listItems(schoolId: string, includeInactive = false) {
    return withTenant(schoolId, (tx) =>
      tx.giftItem.findMany({ take: LIST_CEILING.STRUCTURE,
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
        tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { schoolId },
          select: {
            id: true,
            name: true,
            gradeId: true,
            grade: { select: { id: true, name: true, order: true } },
          },
          orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
        }),
        tx.student.count({ where: { schoolId, isActive: true } }),
      ]);
      // Active roll per section, scoped — see relation-counts.ts.
      const roll = await studentCountsBySection(tx, schoolId, { activeOnly: true });

      const byGrade = new Map<string, { id: string; name: string; order: number; n: number }>();
      for (const s of sections) {
        if (!s.grade) continue;
        const g = byGrade.get(s.grade.id) ?? { id: s.grade.id, name: s.grade.name, order: s.grade.order, n: 0 };
        g.n += roll.get(s.id) ?? 0;
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
          headcount: roll.get(s.id) ?? 0,
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
      // What the DONOR typed beats the school's indicative cost. The list price
      // is the school's estimate of what a thing costs; the donor is telling us
      // what they are actually willing to give, and those are different facts.
      if (dto.unitPriceMinor !== undefined && dto.unitPriceMinor !== null) {
        unitCost = dto.unitPriceMinor;
      }

      const headcount = await this.resolveHeadcount(tx, schoolId, dto);
      if (headcount === 0) {
        throw new ApiError('EMPTY_GROUP', 'There are no children in that group right now.', 409);
      }

      const price = priceForPledge(dto.mode, unitCost, headcount);
      if (!price.ok) throw new ApiError('GIFT_PRICE_REQUIRED', price.problem!, 400);

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
          amountMinor: price.amountMinor,
          unitPriceMinor: price.unitPriceMinor,
          // Asked for on the form only when there is something to collect, so a
          // donor funding a purchase is never asked where to send a courier.
          pickupAddress: dto.mode === 'SUPPLY' ? dto.pickupAddress?.trim() || null : null,
          pickupContact: dto.mode === 'SUPPLY' ? dto.pickupContact?.trim() || null : null,
          pickupPhone: dto.mode === 'SUPPLY' ? dto.pickupPhone?.trim() || null : null,
          pickupNote: dto.mode === 'SUPPLY' ? dto.pickupNote?.trim() || null : null,
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
          // The office needs to see what it has already sent the donor, so it
          // does not add the same photograph three times.
          attachments: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, kind: true, url: true, caption: true, createdAt: true },
          },
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
  /**
   * Everything one alumnus has ever given, with the story of each.
   *
   * This is the screen that decides whether somebody gives twice. A donation
   * that vanishes into an institution and is never mentioned again reads as
   * having been unwelcome, so the history carries the journey, the school's
   * own words, and the photographs — not just a row and a status.
   */
  async listPledgesForAlumnus(schoolId: string, alumniId: string) {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.giftPledge.findMany({
        where: { schoolId, alumniId },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
        include: {
          giftItem: { select: { name: true, unit: true, sizesTracked: true } },
          receipts: { select: { receivedQty: true, receivedAt: true } },
          distributions: { select: { distributedQty: true, absentQty: true, distributedAt: true } },
          events: { orderBy: { at: 'asc' }, select: { status: true, note: true, at: true } },
          attachments: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, kind: true, url: true, caption: true, createdAt: true },
          },
        },
      });
      return rows.map((p) => {
        const received = p.receipts.reduce((n, r) => n + r.receivedQty, 0);
        return {
          ...p,
          ...giftShortfall(p.quantity, received),
          // The donor's screen never re-derives these. Two implementations of
          // one state machine is two state machines.
          journey: giftJourney(p.mode),
          journeyIndex: giftJourneyIndex(p.status, p.mode),
          statusLabel: giftStatusLabel(p.status, p.mode),
          // The office's private working notes are NOT part of this — only the
          // events, which are written to be read by the person who gave.
          events: p.events.map((e) => ({
            ...e,
            label: giftStatusLabel(e.status, p.mode),
          })),
        };
      });
    });
  }

  /**
   * The one-line summary above that list.
   *
   * Counts children reached rather than rupees given: the number that means
   * something to a donor is how many people got something, and for an in-kind
   * gift there is deliberately no rupee figure to add up at all.
   */
  async givingSummary(schoolId: string, alumniId: string) {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.giftPledge.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, alumniId, status: { notIn: ['DECLINED', 'CANCELLED'] } },
        select: { quantity: true, status: true, mode: true, amountMinor: true, currency: true },
      });
      const delivered = rows.filter((r) => r.status === 'DISTRIBUTED' || r.status === 'REPORTED');
      return {
        gifts: rows.length,
        inFlight: rows.length - delivered.length,
        childrenReached: delivered.reduce((n, r) => n + r.quantity, 0),
        // Funded gifts only, and only where the school has actually banked it.
        fundedMinor: rows
          .filter((r) => r.mode === 'FUND')
          .reduce((n, r) => n + (r.amountMinor ?? 0), 0),
        currency: rows[0]?.currency ?? 'INR',
      };
    });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Append one line to a pledge's history.
   *
   * Called on EVERY move, including the ones the office makes without thinking
   * of them as events. The donor's screen is built entirely from these rows, so
   * a transition that forgets to log is a transition that, to the person who
   * gave the money, silently did not happen.
   */
  private async logEvent(
    tx: TenantTx,
    schoolId: string,
    pledgeId: string,
    status: GiftStatus,
    actor: { userId?: string | null; alumniId?: string | null },
    note?: string | null,
  ) {
    await tx.giftEvent.create({
      data: {
        schoolId,
        pledgeId,
        status,
        note: note?.trim() || null,
        byUserId: actor.userId ?? null,
        byAlumniId: actor.alumniId ?? null,
      },
    });
  }

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
      const next = nextGiftStatus(pledge.status, dto.action, pledge.mode);
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          `A ${pledge.status.toLowerCase()} pledge cannot be ${dto.action.toLowerCase()}ed.`,
          409,
        );
      }
      await this.logEvent(tx, schoolId, pledgeId, next, { userId },
        dto.action === 'DECLINE' ? dto.reason : dto.action === 'COUNTER' ? dto.counterNote : null);
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
      const next = nextGiftStatus(pledge.status, 'RECEIVE', pledge.mode);
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
      const view = giftShortfall(pledge.quantity, received);
      await this.logEvent(tx, schoolId, pledgeId, next, { userId },
        view.short > 0
          ? `${dto.receivedQty} received — ${view.short} still to come.`
          : dto.note ?? `${dto.receivedQty} received.`);
      return view;
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
      const next = nextGiftStatus(pledge.status, 'DISTRIBUTE', pledge.mode);
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
      await this.logEvent(tx, schoolId, pledgeId, next, { userId },
        (dto.absentQty ?? 0) > 0
          ? `Given to ${dto.distributedQty}. ${dto.absentQty} were away and are still owed theirs.`
          : dto.note ?? `Given to ${dto.distributedQty} children.`);
      return tx.giftPledge.update({ where: { id: pledgeId }, data: { status: next } });
    });
  }

  /**
   * "Come and get it." Raised by EITHER side — the donor when they pledge or
   * later from their own screen, the office when they ring to arrange it.
   *
   * Re-callable on purpose: an address gets corrected, a date moves, somebody
   * else answers the phone. Each call updates the details and logs a line, so
   * the donor can see the arrangement changed rather than wondering.
   */
  async requestPickup(
    schoolId: string,
    pledgeId: string,
    actor: { userId?: string | null; alumniId?: string | null },
    dto: RequestPickupDto,
  ) {
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({ where: { id: pledgeId, schoolId } });
      if (!pledge) throw new NotFoundException('Pledge not found');
      // A donor may only touch their own, and only their own. The office route
      // passes no alumniId and is authorised by its own guard.
      if (actor.alumniId && pledge.alumniId !== actor.alumniId) {
        throw new NotFoundException('Pledge not found');
      }
      if (pledge.mode !== 'SUPPLY') {
        throw new ApiError(
          'GIFT_NOT_COLLECTABLE',
          'Nothing is being collected — this gift is money, and the school buys locally.',
          409,
        );
      }
      const already = pledge.status === 'PICKUP_REQUESTED';
      const next = already ? 'PICKUP_REQUESTED' : nextGiftStatus(pledge.status, 'REQUEST_PICKUP', pledge.mode);
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          `Collection cannot be arranged for a ${pledge.status.toLowerCase()} pledge.`,
          409,
        );
      }
      const updated = await tx.giftPledge.update({
        where: { id: pledgeId },
        data: {
          status: next,
          pickupAddress: dto.pickupAddress.trim(),
          pickupContact: dto.pickupContact?.trim() || null,
          pickupPhone: dto.pickupPhone?.trim() || null,
          pickupNote: dto.pickupNote?.trim() || null,
          pickupRequestedAt: pledge.pickupRequestedAt ?? new Date(),
        },
      });
      await this.logEvent(tx, schoolId, pledgeId, next, actor,
        already ? 'Collection details updated.' : `Collection arranged from ${dto.pickupAddress.trim()}.`);
      return updated;
    });
  }

  /**
   * It has left. Courier and reference are both optional and independent:
   * plenty of gifts travel in somebody's car boot, and a reference with no
   * carrier is a number nobody can look up.
   */
  async markPickedUp(
    schoolId: string,
    pledgeId: string,
    actor: { userId?: string | null; alumniId?: string | null },
    dto: MarkPickedUpDto,
  ) {
    if (dto.trackingRef?.trim() && !dto.courier?.trim()) {
      throw new ApiError(
        'COURIER_REQUIRED',
        'Say who is carrying it — a tracking number with no carrier cannot be looked up.',
        400,
      );
    }
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({ where: { id: pledgeId, schoolId } });
      if (!pledge) throw new NotFoundException('Pledge not found');
      if (actor.alumniId && pledge.alumniId !== actor.alumniId) {
        throw new NotFoundException('Pledge not found');
      }
      const next = nextGiftStatus(pledge.status, 'MARK_PICKED_UP', pledge.mode);
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          `A ${pledge.status.toLowerCase()} pledge is not waiting to be collected.`,
          409,
        );
      }
      const updated = await tx.giftPledge.update({
        where: { id: pledgeId },
        data: {
          status: next,
          courier: dto.courier?.trim() || null,
          trackingRef: dto.trackingRef?.trim() || null,
          pickedUpAt: new Date(),
        },
      });
      await this.logEvent(tx, schoolId, pledgeId, next, actor,
        dto.courier?.trim()
          ? `Collected by ${dto.courier.trim()}${dto.trackingRef?.trim() ? ` — ${dto.trackingRef.trim()}` : ''}.`
          : 'Collected.');
      return updated;
    });
  }

  /** FUND only: the money has been spent on the thing it was given for. */
  async purchase(schoolId: string, pledgeId: string, userId: string | null, dto: PurchaseGiftDto) {
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({ where: { id: pledgeId, schoolId } });
      if (!pledge) throw new NotFoundException('Pledge not found');
      const next = nextGiftStatus(pledge.status, 'PURCHASE', pledge.mode);
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          pledge.mode === 'SUPPLY'
            ? 'The donor is sending the goods — there is nothing for the school to buy.'
            : `Nothing can be bought against a ${pledge.status.toLowerCase()} pledge.`,
          409,
        );
      }
      const updated = await tx.giftPledge.update({
        where: { id: pledgeId },
        data: { status: next, purchasedAt: new Date() },
      });
      await this.logEvent(tx, schoolId, pledgeId, next, { userId }, dto.note ?? 'Bought by the school.');
      return updated;
    });
  }

  /**
   * The school's word back to the donor.
   *
   * Deliberately NOT a status. It can be written at any point once the gift is
   * real, edited afterwards, and it does not move the pledge — because a thank
   * you is not a stage of a workflow, and making it one would mean somebody
   * had to reach the end of the process before being allowed to say it.
   */
  async thankYou(schoolId: string, pledgeId: string, userId: string | null, dto: ThankYouDto) {
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({ where: { id: pledgeId, schoolId } });
      if (!pledge) throw new NotFoundException('Pledge not found');
      if (pledge.status === 'PROPOSED' || pledge.status === 'DECLINED') {
        throw new ApiError(
          'GIFT_NOT_ACCEPTED',
          'Accept the gift before thanking somebody for it.',
          409,
        );
      }
      const updated = await tx.giftPledge.update({
        where: { id: pledgeId },
        data: { thankYouNote: dto.note.trim(), thankYouAt: new Date(), thankYouByUserId: userId },
      });
      await this.logEvent(tx, schoolId, pledgeId, pledge.status, { userId }, 'The school sent a note.');
      return updated;
    });
  }

  /**
   * Hang a photograph or a document on a pledge.
   *
   * These are NOT site media: a distribution photograph must never land in the
   * school's media library, where it could be dropped onto a public page by
   * accident. It is stored under the pledge and deleted with it.
 *
 * NOTE on where it lives: unlike fee proofs and print-order PDFs, this object
 * is still in the PUBLIC bucket, because it is read back from a stored URL
 * rather than presigned on demand — moving it needs a read-path change first.
 * The key carries a randomUUID so it is not discoverable, but a link that
 * leaks once is permanent. Do not describe this as private until it is.
 */
  async attach(
    schoolId: string,
    pledgeId: string,
    userId: string | null,
    file: { originalname: string; buffer: Buffer; mimetype: string },
    dto: AttachGiftDto,
  ) {
    if (!file) throw new ApiError('FILE_REQUIRED', 'Choose a file first.', 400);
    // Allowlisted by name already; now also verified against the bytes.
    const uploadKind = assertUploadKind(file.buffer, IMAGE_OR_PDF_KINDS, 'attachment');
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({ where: { id: pledgeId, schoolId } });
      if (!pledge) throw new NotFoundException('Pledge not found');
      const stored = await this.storage.upload(
        `schools/${schoolId}/gifts/${pledgeId}`,
        file.originalname,
        file.buffer,
        uploadKind.mime,
      );
      const row = await tx.giftAttachment.create({
        data: {
          schoolId,
          pledgeId,
          kind: dto.kind,
          storageKey: stored.key,
          url: stored.url,
          caption: dto.caption?.trim() || null,
          byUserId: userId,
        },
      });
      await this.logEvent(tx, schoolId, pledgeId, pledge.status, { userId },
        dto.kind === 'DISTRIBUTION' ? 'Photographs from the handover added.'
          : dto.kind === 'BILL' ? 'The bill was added.'
          : 'A photograph of the consignment was added.');
      return row;
    });
  }

  async removeAttachment(schoolId: string, pledgeId: string, attachmentId: string) {
    return withTenant(schoolId, async (tx) => {
      const row = await tx.giftAttachment.findFirst({ where: { id: attachmentId, pledgeId, schoolId } });
      if (!row) throw new NotFoundException('Attachment not found');
      await tx.giftAttachment.delete({ where: { id: attachmentId } });
      // Storage last: a row that survives its file is a broken image, but a
      // file that survives its row is only a byte nobody reads.
      await this.storage.delete(row.storageKey).catch(() => undefined);
      return { ok: true };
    });
  }

  async report(schoolId: string, pledgeId: string) {
    return withTenant(schoolId, async (tx) => {
      const pledge = await tx.giftPledge.findFirst({ where: { id: pledgeId, schoolId } });
      if (!pledge) throw new NotFoundException('Pledge not found');
      const next = nextGiftStatus(pledge.status, 'REPORT', pledge.mode);
      if (!next) {
        throw new ApiError(
          'GIFT_TRANSITION_ILLEGAL',
          'Only a distributed gift can be reported back.',
          409,
        );
      }
      await this.logEvent(tx, schoolId, pledgeId, next, { userId: null });
      return tx.giftPledge.update({ where: { id: pledgeId }, data: { status: next } });
    });
  }
}
