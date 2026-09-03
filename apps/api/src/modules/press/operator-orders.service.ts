import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import type { OperatorOrderArtifact, OperatorOrderRow, PrintOrderDetail, PrintOrderStatus, ReportCardSnapshot } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { StorageService } from '../../common/storage/storage.service';
import { assertTransition, toRow } from './press-orders.service';
import type { DeclineOrderDto, DispatchOrderDto, QuoteOrderDto } from './press-orders.dto';

/**
 * The operator's order desk — every school's print orders on one screen,
 * served at sckools.com/sv/orders. Platform client by design: this desk IS
 * the cross-tenant read, behind OwnerHostGuard + the platform JWT.
 *
 * The operator quotes (price + promised date — the promise is LOGGED and
 * lateness is measured against it), declines with a reason, and walks
 * confirmed orders through printing → dispatched → delivered. Same transition
 * map as the school side; every move writes the same event log.
 */

/** IST calendar date — a promise made for "Friday" is Friday in the school's
 *  timezone, not UTC's. */
function istDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

const OPEN_STATUSES = ['QUOTED', 'CONFIRMED', 'PRINTING', 'DISPATCHED'];

@Injectable()
export class OperatorOrdersService {
  constructor(private readonly storage: StorageService) {}

  async listAll(status?: string): Promise<OperatorOrderRow[]> {
    const db = getPlatformPrisma();
    const rows = await db.printOrder.findMany({
      where: status ? { status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_CEILING.ACTIVITY,
      include: { school: { select: { name: true, slug: true, profile: { select: { city: true } } } } },
    });
    const today = istDateStr(new Date());
    return rows.map((o) => {
      const promised = o.promisedBy ? istDateStr(o.promisedBy) : null;
      const late = promised !== null && OPEN_STATUSES.includes(o.status) && promised < today
        ? Math.round((Date.parse(today) - Date.parse(promised)) / 86_400_000)
        : null;
      const src = o.source as Record<string, unknown>;
      return {
        ...toRow(o),
        schoolName: o.school.name,
        schoolSlug: o.school.slug,
        city: o.school.profile?.city ?? null,
        deliverTo: o.deliverTo as OperatorOrderRow['deliverTo'],
        source: src.kind === 'UPLOAD'
          ? { kind: 'UPLOAD' as const, filename: String(src.filename ?? ''), bytes: Number(src.bytes ?? 0) }
          : {
              kind: 'REPORT_CARDS' as const,
              windowName: String(src.windowName ?? ''),
              classLabel: String(src.classLabel ?? ''),
              issuedCount: Number(src.issuedCount ?? 0),
              serialFrom: String(src.serialFrom ?? ''),
              serialTo: String(src.serialTo ?? ''),
            },
        orderNote: o.note,
        confidential: o.kind === 'UPLOAD',
        daysLate: late,
      };
    });
  }

  /** One order with its timeline — the school's detail shape plus nothing:
   *  the operator reads the same truth the school does. */
  async one(id: string): Promise<PrintOrderDetail & { schoolName: string }> {
    const db = getPlatformPrisma();
    const o = await db.printOrder.findUnique({
      where: { id },
      include: {
        school: { select: { name: true } },
        events: { orderBy: { at: 'asc' }, take: 100 },
      },
    });
    if (!o) throw new ApiError('NOT_FOUND', 'That order was not found.', 404);
    const src = o.source as Record<string, unknown>;
    return {
      ...toRow(o),
      schoolName: o.school.name,
      note: o.note,
      deliverTo: o.deliverTo as PrintOrderDetail['deliverTo'],
      source: src.kind === 'UPLOAD'
        ? { kind: 'UPLOAD', filename: String(src.filename ?? ''), bytes: Number(src.bytes ?? 0) }
        : {
            kind: 'REPORT_CARDS',
            windowName: String(src.windowName ?? ''),
            classLabel: String(src.classLabel ?? ''),
            issuedCount: Number(src.issuedCount ?? 0),
            serialFrom: String(src.serialFrom ?? ''),
            serialTo: String(src.serialTo ?? ''),
          },
      events: o.events.map((e) => ({
        at: e.at.toISOString(),
        actor: e.actor as 'SCHOOL' | 'SCKOOLS',
        action: e.action as PrintOrderStatus,
        note: e.note,
        data: e.data as Record<string, unknown> | null,
      })),
    };
  }

  /** Price + promised date. Revisable until the school confirms — after that
   *  the transition map refuses, because a promise the school accepted is
   *  frozen (the quote IS the contract). */
  async quote(id: string, dto: QuoteOrderDto): Promise<{ ok: true }> {
    const db = getPlatformPrisma();
    const o = await db.printOrder.findUnique({ where: { id }, select: { schoolId: true, status: true } });
    if (!o) throw new ApiError('NOT_FOUND', 'That order was not found.', 404);
    assertTransition('SCKOOLS', o.status, 'QUOTED');
    await db.printOrder.update({
      where: { id },
      data: {
        status: 'QUOTED',
        quotePriceMinor: dto.priceMinor,
        promisedBy: new Date(dto.promisedBy),
        quoteNote: dto.note?.trim() || null,
        quotedAt: new Date(),
        events: {
          create: {
            schoolId: o.schoolId, actor: 'SCKOOLS', action: 'QUOTED',
            note: dto.note?.trim() || null,
            data: { priceMinor: dto.priceMinor, promisedBy: dto.promisedBy },
          },
        },
      },
    });
    return { ok: true };
  }

  async decline(id: string, dto: DeclineOrderDto): Promise<{ ok: true }> {
    const db = getPlatformPrisma();
    const o = await db.printOrder.findUnique({ where: { id }, select: { schoolId: true, status: true } });
    if (!o) throw new ApiError('NOT_FOUND', 'That order was not found.', 404);
    assertTransition('SCKOOLS', o.status, 'DECLINED');
    await db.printOrder.update({
      where: { id },
      data: {
        status: 'DECLINED',
        events: { create: { schoolId: o.schoolId, actor: 'SCKOOLS', action: 'DECLINED', note: dto.reason.trim() } },
      },
    });
    return { ok: true };
  }

  async markPrinting(id: string): Promise<{ ok: true }> {
    return this.simpleMove(id, 'PRINTING', null);
  }

  async dispatch(id: string, dto: DispatchOrderDto): Promise<{ ok: true }> {
    // The DTO already refuses a missing courier; the ref rides along with it.
    return this.simpleMove(id, 'DISPATCHED', { courier: dto.courier.trim(), ref: dto.ref?.trim() || null });
  }

  async markDelivered(id: string): Promise<{ ok: true }> {
    return this.simpleMove(id, 'DELIVERED', null);
  }

  private async simpleMove(id: string, to: PrintOrderStatus, data: Record<string, unknown> | null): Promise<{ ok: true }> {
    const db = getPlatformPrisma();
    const o = await db.printOrder.findUnique({ where: { id }, select: { schoolId: true, status: true } });
    if (!o) throw new ApiError('NOT_FOUND', 'That order was not found.', 404);
    assertTransition('SCKOOLS', o.status, to);
    await db.printOrder.update({
      where: { id },
      data: {
        status: to,
        events: { create: { schoolId: o.schoolId, actor: 'SCKOOLS', action: to, ...(data ? { data: data as object } : {}) } },
      },
    });
    return { ok: true };
  }

  /** What to actually print. Report cards come back as the register's frozen
   *  snapshots — NEVER recompiled, so what the operator prints is
   *  byte-identical to what the school issued. Uploads come back as one
   *  short-lived private link; the file has no public URL anywhere. */
  async artifact(id: string): Promise<OperatorOrderArtifact> {
    const db = getPlatformPrisma();
    const o = await db.printOrder.findUnique({
      where: { id },
      select: { kind: true, schoolId: true, source: true, status: true },
    });
    if (!o) throw new ApiError('NOT_FOUND', 'That order was not found.', 404);
    // No peeking before the school has committed: the artifact opens once the
    // order is confirmed (or beyond). Quoting needs the counts on the row,
    // not the pages themselves.
    if (!['CONFIRMED', 'PRINTING', 'DISPATCHED', 'DELIVERED'].includes(o.status)) {
      throw new ApiError('ORDER_TRANSITION_ILLEGAL', 'The artifact opens once the school confirms the order.', 409);
    }
    const src = o.source as Record<string, unknown>;
    if (o.kind === 'UPLOAD') {
      const url = await this.storage.presignedGet(String(src.fileKey), 900);
      return { kind: 'UPLOAD', filename: String(src.filename ?? ''), url, expiresInSeconds: 900 };
    }
    const issues = await db.pressIssue.findMany({
      where: {
        schoolId: o.schoolId,
        type: 'REPORT_CARD',
        windowId: String(src.windowId),
        voidedAt: null,
        student: { classSectionId: String(src.classSectionId) },
      },
      select: { serial: true, payload: true },
      orderBy: { serial: 'asc' },
      take: LIST_CEILING.ROSTER,
    });
    return {
      kind: 'REPORT_CARDS',
      sheets: issues.map((i) => ({ serial: i.serial, snapshot: i.payload as unknown as ReportCardSnapshot })),
    };
  }
}
