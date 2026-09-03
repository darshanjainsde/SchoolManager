import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import type { PrintOrderDetail, PrintOrderRow, PrintOrderStatus, PrintSpec } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { StorageService } from '../../common/storage/storage.service';
import type { CancelOrderDto, CreateReportCardOrderDto, CreateUploadOrderDto } from './press-orders.dto';

/**
 * Press Orders, the school's side: ask Sckools to do the printing.
 *
 * Request → quote → confirm → printing → dispatched → delivered. The school
 * REQUESTS and CONFIRMS; everything else is the operator's move (see
 * OperatorOrdersService). Both sides run the same transition map, and every
 * move writes a PrintOrderEvent — the timeline both desks render IS the event
 * log, so a move that forgot to log did not happen.
 *
 * What gets printed is never recompiled: a report-card order references the
 * register's ISSUED, immutable snapshots (hence ISSUED_BATCH_REQUIRED — an
 * unissued batch has nothing frozen to print), and an upload is its own
 * artefact, stored privately and served to the operator alone.
 */

/** Who may move an order where. One map, both services. */
export const ORDER_TRANSITIONS: Record<'SCHOOL' | 'SCKOOLS', Partial<Record<PrintOrderStatus, PrintOrderStatus[]>>> = {
  SCHOOL: {
    CONFIRMED: ['QUOTED'],
    // Once confirmed the paper may already be on the press — cancelling then
    // is a phone call, and the operator declines from their desk.
    CANCELLED: ['REQUESTED', 'QUOTED'],
  },
  SCKOOLS: {
    QUOTED: ['REQUESTED', 'QUOTED'], // re-quote until confirmed, never after
    DECLINED: ['REQUESTED', 'QUOTED'],
    PRINTING: ['CONFIRMED'],
    DISPATCHED: ['PRINTING'],
    DELIVERED: ['PRINTING', 'DISPATCHED'], // hand-delivery skips the courier
  },
};

export function assertTransition(actor: 'SCHOOL' | 'SCKOOLS', from: string, to: PrintOrderStatus): void {
  if (!(ORDER_TRANSITIONS[actor][to] ?? []).includes(from as PrintOrderStatus)) {
    throw new ApiError('ORDER_TRANSITION_ILLEGAL', `A ${from.toLowerCase()} order cannot move to ${to.toLowerCase()}.`, 409);
  }
}

const MAX_ORDER_PDF_BYTES = 25 * 1024 * 1024;
export { MAX_ORDER_PDF_BYTES };

type OrderRecord = {
  id: string; kind: string; title: string; quantity: number; spec: unknown;
  status: string; neededBy: Date | null; createdAt: Date;
  quotePriceMinor: number | null; promisedBy: Date | null; quoteNote: string | null; quotedAt: Date | null;
};

export function toRow(o: OrderRecord): PrintOrderRow {
  return {
    id: o.id,
    kind: o.kind as PrintOrderRow['kind'],
    title: o.title,
    quantity: o.quantity,
    spec: o.spec as PrintSpec,
    status: o.status as PrintOrderStatus,
    neededBy: o.neededBy ? o.neededBy.toISOString() : null,
    quote: o.quotePriceMinor !== null && o.promisedBy !== null && o.quotedAt !== null
      ? { priceMinor: o.quotePriceMinor, promisedBy: o.promisedBy.toISOString(), note: o.quoteNote, quotedAt: o.quotedAt.toISOString() }
      : null,
    createdAt: o.createdAt.toISOString(),
  };
}

@Injectable()
export class PressOrdersService {
  constructor(private readonly storage: StorageService) {}

  /** Where the parcel goes — denormalised at request time so the operator's
   *  desk reads one row even if the school edits its profile mid-order. */
  private async deliverTo(tx: TenantTx, schoolId: string, userId: string) {
    const [school, profile, user] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      tx.schoolProfile.findFirst({
        where: { schoolId },
        select: { addressLine1: true, city: true, region: true, phone: true },
      }),
      tx.user.findFirst({ where: { id: userId }, select: { username: true, email: true } }),
    ]);
    return {
      schoolName: school?.name ?? '',
      address: [profile?.addressLine1, profile?.city, profile?.region].filter(Boolean).join(', '),
      contactName: user?.username ?? user?.email ?? '',
      phone: profile?.phone ?? '',
    };
  }

  private spec(dto: CreateReportCardOrderDto | CreateUploadOrderDto): PrintSpec {
    return {
      size: dto.size, colour: dto.colour, sides: dto.sides, gsm: dto.gsm, finish: dto.finish,
    } as PrintSpec;
  }

  /** Bulk-print an ISSUED report-card batch. The order references the frozen
   *  register rows; the operator's artifact endpoint renders exactly those. */
  async createForReportCards(schoolId: string, dto: CreateReportCardOrderDto, userId: string): Promise<PrintOrderDetail> {
    return withTenant(schoolId, async (tx) => {
      const [window, section] = await Promise.all([
        tx.reportWindow.findFirst({ where: { id: dto.windowId }, select: { name: true } }),
        tx.classSection.findFirst({
          where: { id: dto.classSectionId },
          select: { name: true, grade: { select: { name: true } } },
        }),
      ]);
      if (!window) throw new ApiError('NOT_FOUND', 'That report window was not found.', 404);
      if (!section) throw new ApiError('NOT_FOUND', 'That class was not found.', 404);

      const issues = await tx.pressIssue.findMany({
        where: {
          type: 'REPORT_CARD', windowId: dto.windowId, voidedAt: null,
          student: { classSectionId: dto.classSectionId },
        },
        select: { serial: true },
        orderBy: { serial: 'asc' },
        take: LIST_CEILING.ROSTER,
      });
      if (issues.length === 0) {
        throw new ApiError(
          'ISSUED_BATCH_REQUIRED',
          'Issue this batch in the Press first — we print the register’s issued cards, and this class has none for that window.',
          409,
        );
      }

      const classLabel = `${section.grade.name}-${section.name}`;
      const order = await tx.printOrder.create({
        data: {
          schoolId,
          kind: 'REPORT_CARDS',
          title: `Report cards · ${window.name} · ${classLabel}`,
          quantity: dto.quantity,
          spec: this.spec(dto) as object,
          source: {
            kind: 'REPORT_CARDS',
            windowId: dto.windowId,
            classSectionId: dto.classSectionId,
            windowName: window.name,
            classLabel,
            issuedCount: issues.length,
            serialFrom: issues[0]!.serial,
            serialTo: issues[issues.length - 1]!.serial,
          },
          deliverTo: await this.deliverTo(tx, schoolId, userId),
          neededBy: dto.neededBy ? new Date(dto.neededBy) : null,
          note: dto.note?.trim() || null,
          events: {
            create: {
              schoolId, actor: 'SCHOOL', action: 'REQUESTED',
              note: dto.note?.trim() || null,
              data: { userId, issuedCount: issues.length },
            },
          },
        },
      });
      return this.detail(tx, order.id);
    });
  }

  /** Print an uploaded PDF — an exam paper, a circular, a form. Confidential:
   *  stored privately, served ONLY to the operator via short-lived links. */
  async createForUpload(
    schoolId: string,
    dto: CreateUploadOrderDto,
    file: { originalname: string; buffer: Buffer; mimetype: string },
    userId: string,
  ): Promise<PrintOrderDetail> {
    if (file.mimetype !== 'application/pdf') {
      throw new ApiError('VALIDATION', 'Only PDF files can be sent to print — export the document as PDF first.', 400, 'file');
    }
    if (file.buffer.length > MAX_ORDER_PDF_BYTES) {
      throw new ApiError('VALIDATION', 'That PDF is over 25 MB — compress it and try again.', 400, 'file');
    }

    // Upload BEFORE the transaction (S3 has no rollback); if the row then
    // fails, delete best-effort so nothing confidential lingers unreferenced.
    const { key } = await this.storage.upload(
      `print-orders/${schoolId}`, file.originalname, file.buffer, file.mimetype,
    );
    try {
      return await withTenant(schoolId, async (tx) => {
        const order = await tx.printOrder.create({
          data: {
            schoolId,
            kind: 'UPLOAD',
            title: dto.title.trim(),
            quantity: dto.quantity,
            spec: this.spec(dto) as object,
            source: {
              kind: 'UPLOAD',
              fileKey: key,
              filename: file.originalname,
              bytes: file.buffer.length,
              contentType: file.mimetype,
            },
            deliverTo: await this.deliverTo(tx, schoolId, userId),
            neededBy: dto.neededBy ? new Date(dto.neededBy) : null,
            note: dto.note?.trim() || null,
            events: {
              create: {
                schoolId, actor: 'SCHOOL', action: 'REQUESTED',
                note: dto.note?.trim() || null,
                data: { userId, filename: file.originalname, bytes: file.buffer.length },
              },
            },
          },
        });
        return this.detail(tx, order.id);
      });
    } catch (e) {
      await this.storage.delete(key);
      throw e;
    }
  }

  async list(schoolId: string): Promise<PrintOrderRow[]> {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.printOrder.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIST_CEILING.ACTIVITY,
      });
      return rows.map(toRow);
    });
  }

  async one(schoolId: string, id: string): Promise<PrintOrderDetail> {
    return withTenant(schoolId, (tx) => this.detail(tx, id));
  }

  /** The school accepts the quote — price and promise FREEZE here. */
  async confirm(schoolId: string, id: string, userId: string): Promise<PrintOrderDetail> {
    return withTenant(schoolId, async (tx) => {
      const order = await tx.printOrder.findFirst({ where: { id }, select: { status: true, quotePriceMinor: true, promisedBy: true } });
      if (!order) throw new ApiError('NOT_FOUND', 'That order was not found.', 404);
      assertTransition('SCHOOL', order.status, 'CONFIRMED');
      await tx.printOrder.update({
        where: { id },
        data: {
          status: 'CONFIRMED', confirmedAt: new Date(),
          events: {
            create: {
              schoolId, actor: 'SCHOOL', action: 'CONFIRMED',
              data: { userId, priceMinor: order.quotePriceMinor, promisedBy: order.promisedBy?.toISOString() ?? null },
            },
          },
        },
      });
      return this.detail(tx, id);
    });
  }

  async cancel(schoolId: string, id: string, dto: CancelOrderDto, userId: string): Promise<PrintOrderDetail> {
    return withTenant(schoolId, async (tx) => {
      const order = await tx.printOrder.findFirst({ where: { id }, select: { status: true } });
      if (!order) throw new ApiError('NOT_FOUND', 'That order was not found.', 404);
      assertTransition('SCHOOL', order.status, 'CANCELLED');
      await tx.printOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          events: { create: { schoolId, actor: 'SCHOOL', action: 'CANCELLED', note: dto.note?.trim() || null, data: { userId } } },
        },
      });
      return this.detail(tx, id);
    });
  }

  private async detail(tx: TenantTx, id: string): Promise<PrintOrderDetail> {
    const o = await tx.printOrder.findFirst({
      where: { id },
      include: { events: { orderBy: { at: 'asc' }, take: 100 } },
    });
    if (!o) throw new ApiError('NOT_FOUND', 'That order was not found.', 404);
    const src = o.source as Record<string, unknown>;
    return {
      ...toRow(o),
      note: o.note,
      deliverTo: o.deliverTo as PrintOrderDetail['deliverTo'],
      // The school's own view never carries the storage key — the source is
      // summarised to what the timeline needs.
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
        data: (e.data as Record<string, unknown> | null),
      })),
    };
  }
}
