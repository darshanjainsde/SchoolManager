import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@skoolos/config';
import { getPlatformPrisma, withTenant, type Prisma, type TenantTx } from '@skoolos/db';
import {
  SUPPORT_AUTO_CLOSE_DAYS,
  SUPPORT_LOOK_IN_HOURS,
  SUPPORT_MAX_FILES,
  SUPPORT_MODULE_LABEL,
  SUPPORT_REOPEN_DAYS,
  SUPPORT_SEVERITY_LABEL,
  SUPPORT_STATUS_LABEL_SCHOOL,
  SUPPORT_TICKET_TYPE_LABEL,
  supportTicketNo,
  type SupportAttachment,
  type SupportBoard,
  type SupportBoardRow,
  type SupportEntryRow,
  type SupportFileLink,
  type SupportModule,
  type SupportOwnerCounts,
  type SupportSchoolCounts,
  type SupportSeverity,
  type SupportStatus,
  type SupportTicketContext,
  type SupportTicketDetail,
  type SupportTicketRow,
  type SupportTicketType,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { MailService } from '../../common/mail/mail.service';
import { requestOutboxDrain } from '../../common/notifications/outbox-signal';
import { StorageService } from '../../common/storage/storage.service';
import { IMAGE_KINDS, assertUploadKind } from '../../common/storage/upload-kind';
import { MarketingService } from '../marketing';
import { ImpersonationService } from '../owner';
import { attachmentName, browserLabel } from './support-context';
import { ownerAlertLetter, schoolUpdateText, type OwnerAlertKind, type SchoolUpdateKind } from './support-letters';
import { assertOwnerMove, autoCloseDue, canConfirm, canReopen, isUnanswered, lookInActive } from './support-status';
import type { CreateTicketDto } from './support.dto';

/** The school admin asking, inside their own tenant. */
export interface SchoolViewer { schoolId: string; userId: string }
/** The platform owner asking, across every tenant. */
export interface Owner { userId: string }

export interface UploadedImage { originalname: string; buffer: Buffer; mimetype: string }

const PREVIEW = 4_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Tickets one school may raise in a rolling day. A cap on what a script can do, not on an honest office. */
const PER_SCHOOL_PER_DAY = 20;
const FILE_TTL = 300;
const LIVE: SupportStatus[] = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING_ON_SCHOOL'];

/**
 * THE SUPPORT DESK — a school reports a problem with Sckools itself; the
 * owner answers it; the school watches every move.
 *
 * Four rules, all enforced HERE and never in a screen:
 *
 *  1. A SCHOOL READS ONLY ITS OWN TICKETS. Every school-side query runs under
 *     `withTenant` AND names `schoolId`; the owner's queries run on the
 *     platform client and name `schoolId` wherever a school is involved.
 *  2. A PRIVATE NOTE NEVER LEAVES THE DESK. `visibleToSchool` is read on the
 *     way OUT for a school viewer, and only a visible reply notifies them.
 *  3. THE MACHINE DECIDES THE MOVES. `assertOwnerMove` refuses what the table
 *     in support-status.ts does not list; the school's own moves (confirm,
 *     reopen, a reply while waiting) are checked against the same clocks.
 *  4. LOOK-IN IS CONSENT WITH A CLOCK. "Open as this school" mints nothing
 *     unless `lookInUntil` is in the future, and every use is a line the
 *     school can read.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly marketing: MarketingService,
    private readonly impersonation: ImpersonationService,
  ) {}

  // ── the school's side ─────────────────────────────────────────────────

  async schoolCounts(v: SchoolViewer): Promise<SupportSchoolCounts> {
    return withTenant(v.schoolId, async (tx) => {
      const [open, waitingOnYou, closed] = await Promise.all([
        tx.supportTicket.count({ where: { schoolId: v.schoolId, status: { not: 'CLOSED' } } }),
        tx.supportTicket.count({ where: { schoolId: v.schoolId, status: { in: ['WAITING_ON_SCHOOL', 'RESOLVED'] } } }),
        tx.supportTicket.count({ where: { schoolId: v.schoolId, status: 'CLOSED' } }),
      ]);
      return { open, waitingOnYou, closed };
    });
  }

  async schoolList(v: SchoolViewer, status: 'OPEN' | 'CLOSED' | 'ALL' = 'OPEN'): Promise<SupportTicketRow[]> {
    return withTenant(v.schoolId, async (tx) => {
      await this.sweep(tx, v.schoolId);
      const where: Prisma.SupportTicketWhereInput = { schoolId: v.schoolId };
      if (status === 'OPEN') where.status = { not: 'CLOSED' };
      if (status === 'CLOSED') where.status = 'CLOSED';
      const rows = await tx.supportTicket.findMany({
        where, take: LIST_CEILING.ACTIVITY, orderBy: [{ lastActivityAt: 'desc' }], include: this.rowInclude(),
      });
      const counts = await this.entryCounts(tx, v.schoolId, rows.map((r) => r.id), true);
      return rows.map((r) => this.toRow(r, 'SCHOOL', counts.get(r.id) ?? 0));
    });
  }

  /**
   * The school raises a ticket. Photos are stored FIRST under a pre-chosen
   * ticket id, then the row is written with their keys in one transaction —
   * so a dead file store answers 503 and records nothing, and a failed write
   * never strands keys nobody can find.
   */
  async create(v: SchoolViewer, dto: CreateTicketDto, files: UploadedImage[], meta: { userAgent: string | null }): Promise<SupportTicketDetail> {
    this.assertFiles(files);
    const ticketId = randomUUID();

    const { me, school } = await withTenant(v.schoolId, async (tx) => {
      const me = await tx.user.findFirst({ where: { id: v.userId, schoolId: v.schoolId }, select: { id: true, name: true, email: true } });
      if (!me) throw new ApiError('NOT_FOUND', 'Sign in again to report a problem.', 404);
      const school = await tx.school.findFirst({ where: { id: v.schoolId }, select: { tier: true, name: true } });
      if (!school) throw new ApiError('NOT_FOUND', 'School not found.', 404);
      const today = await tx.supportTicket.count({ where: { schoolId: v.schoolId, createdAt: { gte: new Date(Date.now() - DAY) } } });
      if (today >= PER_SCHOOL_PER_DAY) {
        throw new ApiError(
          'SUPPORT_DAILY_LIMIT',
          `Your school has raised ${PER_SCHOOL_PER_DAY} tickets in the last day. Add to one of them instead, or try again tomorrow.`,
          429,
        );
      }
      return { me, school };
    });

    const keys = await this.store(v.schoolId, ticketId, files);
    const context: SupportTicketContext = {
      pagePath: dto.pagePath?.trim() || null,
      tier: school.tier,
      browser: browserLabel(meta.userAgent),
      appVersion: dto.appVersion?.trim() || null,
    };
    const now = new Date();
    try {
      await withTenant(v.schoolId, async (tx) => {
        await tx.supportTicket.create({
          data: {
            id: ticketId,
            schoolId: v.schoolId,
            raisedById: v.userId,
            type: dto.type,
            module: dto.module,
            severity: dto.severity,
            title: dto.title.trim().slice(0, 120),
            body: dto.body.trim().slice(0, PREVIEW),
            attachmentKeys: keys,
            context: context as unknown as Prisma.InputJsonValue,
            lookInUntil: dto.allowLookIn ? new Date(now.getTime() + SUPPORT_LOOK_IN_HOURS * HOUR) : null,
            lastActivityAt: now,
            lastSchoolActivityAt: now,
          },
        });
        if (dto.allowLookIn) {
          await tx.supportTicketEntry.create({
            data: {
              schoolId: v.schoolId, ticketId, authorKind: 'SYSTEM', authorName: null, visibleToSchool: true,
              body: `${me.name ?? me.email} allowed Sckools to open the console to investigate, for ${SUPPORT_LOOK_IN_HOURS} hours.`,
            },
          });
        }
      });
    } catch (e) {
      // The row never landed; do not leave its photos behind.
      await Promise.all(keys.map((k) => this.storage.delete(k)));
      throw e;
    }

    await this.notifyOwner('RAISED', v.schoolId, ticketId);
    return this.schoolDetail(v, ticketId);
  }

  async schoolDetail(v: SchoolViewer, id: string): Promise<SupportTicketDetail> {
    return withTenant(v.schoolId, async (tx) => {
      const t = await this.loadDetail(tx, { id, schoolId: v.schoolId });
      return this.toDetail(t, 'SCHOOL', null, 0);
    });
  }

  /** The school writes back, with photos if it has them. A reply while Sckools was waiting on them is their move, so the status follows. */
  async schoolComment(v: SchoolViewer, id: string, body: string, files: UploadedImage[]): Promise<SupportTicketDetail> {
    this.assertFiles(files);
    const t = await withTenant(v.schoolId, (tx) =>
      tx.supportTicket.findFirst({ where: { id, schoolId: v.schoolId }, select: { id: true, status: true } }),
    );
    if (!t) throw this.notFound();
    if (t.status === 'CLOSED') {
      throw new ApiError('SUPPORT_ILLEGAL_MOVE', 'This ticket is closed. Reopen it to write more, or raise a new one.', 409, 'id');
    }
    const keys = await this.store(v.schoolId, id, files);
    const now = new Date();
    try {
      await withTenant(v.schoolId, async (tx) => {
        const me = await tx.user.findFirst({ where: { id: v.userId, schoolId: v.schoolId }, select: { name: true, email: true } });
        const flips = t.status === 'WAITING_ON_SCHOOL';
        await tx.supportTicketEntry.create({
          data: {
            schoolId: v.schoolId, ticketId: id, authorId: v.userId, authorKind: 'SCHOOL', authorName: me?.name ?? me?.email ?? null,
            body: body.trim().slice(0, PREVIEW), attachmentKeys: keys, visibleToSchool: true,
            statusFrom: flips ? 'WAITING_ON_SCHOOL' : null, statusTo: flips ? 'IN_PROGRESS' : null,
          },
        });
        await tx.supportTicket.update({
          where: { id },
          data: { lastActivityAt: now, lastSchoolActivityAt: now, ...(flips ? { status: 'IN_PROGRESS' } : {}) },
        });
      });
    } catch (e) {
      await Promise.all(keys.map((k) => this.storage.delete(k)));
      throw e;
    }
    await this.notifyOwner('REPLIED', v.schoolId, id);
    return this.schoolDetail(v, id);
  }

  /** "Yes, it's fixed." Only a RESOLVED ticket can be closed by the school. */
  async confirm(v: SchoolViewer, id: string): Promise<SupportTicketDetail> {
    await withTenant(v.schoolId, async (tx) => {
      const t = await tx.supportTicket.findFirst({ where: { id, schoolId: v.schoolId }, select: { status: true } });
      if (!t) throw this.notFound();
      if (!canConfirm(t.status as SupportStatus)) {
        throw new ApiError('SUPPORT_ILLEGAL_MOVE', 'Only a ticket Sckools has marked resolved can be confirmed.', 409, 'id');
      }
      const me = await tx.user.findFirst({ where: { id: v.userId, schoolId: v.schoolId }, select: { name: true, email: true } });
      const now = new Date();
      await tx.supportTicketEntry.create({
        data: {
          schoolId: v.schoolId, ticketId: id, authorId: v.userId, authorKind: 'SCHOOL', authorName: me?.name ?? me?.email ?? null,
          body: 'Confirmed fixed.', visibleToSchool: true, statusFrom: 'RESOLVED', statusTo: 'CLOSED',
        },
      });
      await tx.supportTicket.update({ where: { id }, data: { status: 'CLOSED', closedAt: now, lastActivityAt: now, lastSchoolActivityAt: now } });
    });
    return this.schoolDetail(v, id);
  }

  /** The school reopens a resolved or closed ticket, inside the window. */
  async reopen(v: SchoolViewer, id: string, body: string): Promise<SupportTicketDetail> {
    await withTenant(v.schoolId, async (tx) => {
      const t = await tx.supportTicket.findFirst({ where: { id, schoolId: v.schoolId }, select: { status: true, resolvedAt: true } });
      if (!t) throw this.notFound();
      if (!canReopen(t.status as SupportStatus, t.resolvedAt)) {
        throw new ApiError(
          'SUPPORT_REOPEN_WINDOW',
          t.status === 'RESOLVED' || t.status === 'CLOSED'
            ? `A ticket can be reopened within ${SUPPORT_REOPEN_DAYS} days of being resolved. Please raise a new one and mention the old ticket number.`
            : 'This ticket is still open — write a reply instead.',
          400,
          'id',
        );
      }
      const me = await tx.user.findFirst({ where: { id: v.userId, schoolId: v.schoolId }, select: { name: true, email: true } });
      const now = new Date();
      await tx.supportTicketEntry.create({
        data: {
          schoolId: v.schoolId, ticketId: id, authorId: v.userId, authorKind: 'SCHOOL', authorName: me?.name ?? me?.email ?? null,
          body: body.trim().slice(0, PREVIEW), visibleToSchool: true, statusFrom: t.status, statusTo: 'OPEN',
        },
      });
      await tx.supportTicket.update({
        where: { id },
        data: { status: 'OPEN', reopenedAt: now, resolvedAt: null, closedAt: null, lastActivityAt: now, lastSchoolActivityAt: now },
      });
    });
    await this.notifyOwner('REOPENED', v.schoolId, id);
    return this.schoolDetail(v, id);
  }

  /** Consent to look in, or its withdrawal. A timestamp, so it expires by itself. */
  async setLookIn(v: SchoolViewer, id: string, allow: boolean): Promise<SupportTicketDetail> {
    await withTenant(v.schoolId, async (tx) => {
      const t = await tx.supportTicket.findFirst({ where: { id, schoolId: v.schoolId }, select: { id: true } });
      if (!t) throw this.notFound();
      const me = await tx.user.findFirst({ where: { id: v.userId, schoolId: v.schoolId }, select: { name: true, email: true } });
      const who = me?.name ?? me?.email ?? 'The school';
      const now = new Date();
      await tx.supportTicket.update({
        where: { id },
        data: { lookInUntil: allow ? new Date(now.getTime() + SUPPORT_LOOK_IN_HOURS * HOUR) : null, lastActivityAt: now },
      });
      await tx.supportTicketEntry.create({
        data: {
          schoolId: v.schoolId, ticketId: id, authorKind: 'SYSTEM', visibleToSchool: true,
          body: allow
            ? `${who} allowed Sckools to open the console to investigate, for ${SUPPORT_LOOK_IN_HOURS} hours.`
            : `${who} withdrew permission for Sckools to open the console.`,
        },
      });
    });
    return this.schoolDetail(v, id);
  }

  async schoolFile(v: SchoolViewer, id: string, key: string): Promise<SupportFileLink> {
    return withTenant(v.schoolId, async (tx) => {
      await this.assertKeyOnTicket(tx, { id, schoolId: v.schoolId }, key, true);
      return this.link(key);
    });
  }

  // ── the owner's side ──────────────────────────────────────────────────

  async ownerCounts(): Promise<SupportOwnerCounts> {
    const db = getPlatformPrisma();
    const live = await db.supportTicket.findMany({
      where: { status: { in: LIVE } },
      select: { status: true, lastSchoolActivityAt: true, lastOwnerActivityAt: true },
      take: LIST_CEILING.ACTIVITY,
    });
    return this.countsOf(live);
  }

  /** Every school's open tickets, oldest unanswered first. */
  async ownerBoard(): Promise<SupportBoard> {
    const db = getPlatformPrisma();
    await this.sweep(db, null);
    const live = await db.supportTicket.findMany({
      where: { status: { in: LIVE } },
      select: {
        schoolId: true, status: true, title: true, lastSchoolActivityAt: true, lastOwnerActivityAt: true,
        school: { select: { id: true, name: true, slug: true, tier: true } },
      },
      take: LIST_CEILING.ACTIVITY,
      orderBy: { lastSchoolActivityAt: 'asc' },
    });
    const bySchool = new Map<string, SupportBoardRow>();
    for (const t of live) {
      const row = bySchool.get(t.schoolId) ?? {
        schoolId: t.schoolId, name: t.school.name, slug: t.school.slug, tier: t.school.tier,
        open: 0, waitingOnSchool: 0, oldestUnansweredAt: null, oldestUnansweredTitle: null,
      };
      row.open += 1;
      if (t.status === 'WAITING_ON_SCHOOL') row.waitingOnSchool += 1;
      if (isUnanswered(t) && !row.oldestUnansweredAt) {
        row.oldestUnansweredAt = t.lastSchoolActivityAt.toISOString();
        row.oldestUnansweredTitle = t.title;
      }
      bySchool.set(t.schoolId, row);
    }
    const schools = [...bySchool.values()].sort((a, b) => {
      if (a.oldestUnansweredAt && b.oldestUnansweredAt) return a.oldestUnansweredAt < b.oldestUnansweredAt ? -1 : 1;
      if (a.oldestUnansweredAt) return -1;
      if (b.oldestUnansweredAt) return 1;
      return b.open - a.open;
    });
    return { counts: this.countsOf(live), schools };
  }

  async ownerList(f: { schoolId?: string; status?: string; type?: string; module?: string }): Promise<SupportTicketRow[]> {
    const db = getPlatformPrisma();
    const where: Prisma.SupportTicketWhereInput = {};
    if (f.schoolId) where.schoolId = f.schoolId;
    if (f.status && f.status !== 'ALL') where.status = f.status === 'LIVE' ? { in: LIVE } : f.status;
    else if (!f.status) where.status = { not: 'CLOSED' };
    if (f.type) where.type = f.type;
    if (f.module) where.module = f.module;
    const rows = await db.supportTicket.findMany({
      where, take: LIST_CEILING.ACTIVITY, orderBy: [{ lastActivityAt: 'desc' }], include: this.rowInclude(),
    });
    const counts = await this.entryCounts(db, null, rows.map((r) => r.id), false);
    return rows.map((r) => this.toRow(r, 'OWNER', counts.get(r.id) ?? 0));
  }

  async ownerDetail(_o: Owner, id: string): Promise<SupportTicketDetail> {
    const db = getPlatformPrisma();
    const t = await this.loadDetail(db, { id });
    const [assignedTo, sameModuleOpen] = await Promise.all([
      t.assignedOwnerId
        ? db.user.findFirst({ where: { id: t.assignedOwnerId, schoolId: null }, select: { id: true, name: true, email: true } })
        : null,
      db.supportTicket.count({
        where: { module: t.module, schoolId: { not: t.schoolId }, status: { in: LIVE }, createdAt: { gte: new Date(Date.now() - 7 * DAY) } },
      }),
    ]);
    return this.toDetail(t, 'OWNER', assignedTo ? { id: assignedTo.id, name: assignedTo.name ?? assignedTo.email } : null, sameModuleOpen);
  }

  /** Move it along. The table decides; the timestamps follow the move. */
  async ownerStatus(o: Owner, id: string, status: SupportStatus, note?: string): Promise<SupportTicketDetail> {
    const db = getPlatformPrisma();
    const t = await db.supportTicket.findUnique({ where: { id }, select: { schoolId: true, status: true, acknowledgedAt: true } });
    if (!t) throw this.notFound();
    const from = t.status as SupportStatus;
    assertOwnerMove(from, status);
    const now = new Date();
    const who = await this.ownerName(o.userId);
    await db.$transaction([
      db.supportTicketEntry.create({
        data: {
          schoolId: t.schoolId, ticketId: id, authorKind: 'OWNER', authorName: who, visibleToSchool: true,
          body: (note ?? '').trim().slice(0, PREVIEW), statusFrom: from, statusTo: status,
        },
      }),
      db.supportTicket.update({
        where: { id },
        data: {
          status,
          lastActivityAt: now,
          lastOwnerActivityAt: now,
          acknowledgedAt: status === 'ACKNOWLEDGED' && !t.acknowledgedAt ? now : undefined,
          resolvedAt: status === 'RESOLVED' ? now : from === 'RESOLVED' && status !== 'CLOSED' ? null : undefined,
          closedAt: status === 'CLOSED' ? now : undefined,
        },
      }),
    ]);
    const kind: SchoolUpdateKind = status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : status === 'RESOLVED' ? 'RESOLVED' : 'STATUS';
    await this.notifySchool(kind, t.schoolId, id, SUPPORT_STATUS_LABEL_SCHOOL[status]);
    return this.ownerDetail(o, id);
  }

  /** A reply the school reads, or a note only the desk keeps. A private note does not count as answering. */
  async ownerComment(o: Owner, id: string, body: string, visibleToSchool: boolean): Promise<SupportTicketDetail> {
    const db = getPlatformPrisma();
    const t = await db.supportTicket.findUnique({ where: { id }, select: { schoolId: true } });
    if (!t) throw this.notFound();
    const now = new Date();
    const who = await this.ownerName(o.userId);
    await db.$transaction([
      db.supportTicketEntry.create({
        data: { schoolId: t.schoolId, ticketId: id, authorKind: 'OWNER', authorName: who, visibleToSchool, body: body.trim().slice(0, PREVIEW) },
      }),
      db.supportTicket.update({
        where: { id },
        data: { lastActivityAt: now, ...(visibleToSchool ? { lastOwnerActivityAt: now } : {}) },
      }),
    ]);
    if (visibleToSchool) await this.notifySchool('REPLIED', t.schoolId, id);
    return this.ownerDetail(o, id);
  }

  async ownerAssign(o: Owner, id: string, assign: boolean): Promise<SupportTicketDetail> {
    const db = getPlatformPrisma();
    const t = await db.supportTicket.findUnique({ where: { id }, select: { schoolId: true } });
    if (!t) throw this.notFound();
    const who = await this.ownerName(o.userId);
    await db.$transaction([
      db.supportTicket.update({ where: { id }, data: { assignedOwnerId: assign ? o.userId : null } }),
      db.supportTicketEntry.create({
        data: { schoolId: t.schoolId, ticketId: id, authorKind: 'OWNER', authorName: who, visibleToSchool: false, body: assign ? `${who} took this ticket.` : `${who} unassigned this ticket.` },
      }),
    ]);
    return this.ownerDetail(o, id);
  }

  async ownerPatch(o: Owner, id: string, externalRef: string | null): Promise<SupportTicketDetail> {
    const db = getPlatformPrisma();
    const t = await db.supportTicket.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw this.notFound();
    await db.supportTicket.update({ where: { id }, data: { externalRef: externalRef?.trim().slice(0, 120) || null } });
    return this.ownerDetail(o, id);
  }

  /** "Open as this school" — only while the school's consent clock is running, and always on the record. */
  async openSchool(o: Owner, id: string): Promise<{ url: string; expiresInSeconds: number }> {
    const db = getPlatformPrisma();
    const t = await db.supportTicket.findUnique({ where: { id }, select: { schoolId: true, lookInUntil: true } });
    if (!t) throw this.notFound();
    if (!lookInActive(t.lookInUntil)) {
      throw new ApiError(
        'SUPPORT_LOOK_IN_REQUIRED',
        'The school has not allowed Sckools to open its console for this ticket, or the permission has expired. Ask them to switch it on from their Help page.',
        409,
      );
    }
    const minted = await this.impersonation.mint(t.schoolId, o.userId);
    const who = await this.ownerName(o.userId);
    const now = new Date();
    await db.$transaction([
      db.supportTicketEntry.create({
        data: { schoolId: t.schoolId, ticketId: id, authorKind: 'SYSTEM', visibleToSchool: true, body: `Sckools (${who}) opened your console to investigate this ticket.` },
      }),
      db.supportTicket.update({ where: { id }, data: { lastActivityAt: now, lastOwnerActivityAt: now } }),
    ]);
    await this.notifySchool('OPENED', t.schoolId, id);
    return minted;
  }

  async ownerFile(id: string, key: string): Promise<SupportFileLink> {
    const db = getPlatformPrisma();
    await this.assertKeyOnTicket(db, { id }, key, false);
    return this.link(key);
  }

  // ── the clock nobody presses ──────────────────────────────────────────

  /**
   * A RESOLVED ticket the school has left alone for the quiet period closes
   * itself, with a line saying so. Run at the top of the reads that would
   * otherwise show it as still waiting; idempotent and bounded.
   */
  async sweep(db: TenantTx, schoolId: string | null): Promise<number> {
    const cutoff = new Date(Date.now() - SUPPORT_AUTO_CLOSE_DAYS * DAY);
    const due = await db.supportTicket.findMany({
      where: { ...(schoolId ? { schoolId } : {}), status: 'RESOLVED', resolvedAt: { lt: cutoff } },
      select: { id: true, schoolId: true, resolvedAt: true },
      take: 200,
    });
    const now = new Date();
    for (const t of due) {
      if (!autoCloseDue(t.resolvedAt, now)) continue;
      await db.supportTicket.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: now, lastActivityAt: now } });
      await db.supportTicketEntry.create({
        data: {
          schoolId: t.schoolId, ticketId: t.id, authorKind: 'SYSTEM', visibleToSchool: true, statusFrom: 'RESOLVED', statusTo: 'CLOSED',
          body: `Closed automatically after ${SUPPORT_AUTO_CLOSE_DAYS} quiet days. You can still reopen it for ${SUPPORT_REOPEN_DAYS} days after it was resolved.`,
        },
      });
    }
    return due.length;
  }

  // ── internals ─────────────────────────────────────────────────────────

  private assertFiles(files: UploadedImage[]): void {
    if (files.length > SUPPORT_MAX_FILES) {
      throw new ApiError('VALIDATION', `Attach up to ${SUPPORT_MAX_FILES} photos.`, 400, 'files');
    }
    for (const f of files) assertUploadKind(f.buffer, IMAGE_KINDS, 'photo', { field: 'files' });
  }

  /** Private storage, keyed under the ticket so a key names where it belongs. */
  private async store(schoolId: string, ticketId: string, files: UploadedImage[]): Promise<string[]> {
    const keys: string[] = [];
    for (const f of files) {
      const { mime } = assertUploadKind(f.buffer, IMAGE_KINDS, 'photo', { field: 'files' });
      try {
        const up = await this.storage.upload(`support/${schoolId}/${ticketId}`, f.originalname || 'photo', f.buffer, mime, { private: true });
        keys.push(up.key);
      } catch (e) {
        await Promise.all(keys.map((k) => this.storage.delete(k)));
        throw e;
      }
    }
    return keys;
  }

  private async assertKeyOnTicket(db: TenantTx, where: { id: string; schoolId?: string }, key: string, schoolSide: boolean): Promise<void> {
    if (!key || !key.startsWith('support/')) throw new ApiError('NOT_FOUND', 'That file is not on this ticket.', 404, 'key');
    const t = await db.supportTicket.findFirst({ where, select: { id: true, attachmentKeys: true } });
    if (!t) throw this.notFound();
    if (t.attachmentKeys.includes(key)) return;
    const entry = await db.supportTicketEntry.findFirst({
      where: { ticketId: t.id, ...(where.schoolId ? { schoolId: where.schoolId } : {}), attachmentKeys: { has: key }, ...(schoolSide ? { visibleToSchool: true } : {}) },
      select: { id: true },
    });
    if (!entry) throw new ApiError('NOT_FOUND', 'That file is not on this ticket.', 404, 'key');
  }

  private async link(key: string): Promise<SupportFileLink> {
    return { url: await this.storage.presignedGet(key, FILE_TTL), expiresInSeconds: FILE_TTL, name: attachmentName(key) };
  }

  private notFound(): ApiError {
    return new ApiError('NOT_FOUND', 'That ticket was not found.', 404, 'id');
  }

  private rowInclude() {
    return {
      raisedBy: { select: { name: true, email: true } },
      school: { select: { id: true, name: true, slug: true, tier: true } },
    } as const;
  }

  /** Entries per ticket, tallied for THESE rows only — never Prisma's relation `_count`. */
  private async entryCounts(db: TenantTx, schoolId: string | null, ids: string[], visibleOnly: boolean): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db.supportTicketEntry.groupBy({
      by: ['ticketId'],
      where: { ticketId: { in: ids }, ...(schoolId ? { schoolId } : {}), ...(visibleOnly ? { visibleToSchool: true } : {}) },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.ticketId, r._count._all]));
  }

  private async loadDetail(db: TenantTx, where: { id: string; schoolId?: string }) {
    const t = await db.supportTicket.findFirst({
      where,
      include: {
        ...this.rowInclude(),
        entries: { orderBy: { createdAt: 'asc' }, take: LIST_CEILING.ACTIVITY },
      },
    });
    if (!t) throw this.notFound();
    return t;
  }

  private countsOf(live: { status: string; lastSchoolActivityAt: Date; lastOwnerActivityAt: Date | null }[]): SupportOwnerCounts {
    const dayAgo = Date.now() - DAY;
    let unanswered = 0;
    let pastDay = 0;
    for (const t of live) {
      if (!isUnanswered(t)) continue;
      unanswered += 1;
      if (t.lastSchoolActivityAt.getTime() < dayAgo) pastDay += 1;
    }
    return {
      unanswered,
      pastDay,
      inProgress: live.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'ACKNOWLEDGED').length,
      waitingOnSchool: live.filter((t) => t.status === 'WAITING_ON_SCHOOL').length,
      open: live.length,
    };
  }

  private toRow(t: TicketRecord, side: 'SCHOOL' | 'OWNER', entryCount: number): SupportTicketRow {
    return {
      id: t.id,
      number: t.number,
      ticketNo: supportTicketNo(t.number),
      type: t.type as SupportTicketType,
      module: t.module as SupportModule,
      severity: t.severity as SupportSeverity,
      title: t.title,
      status: t.status as SupportStatus,
      createdAt: t.createdAt.toISOString(),
      lastActivityAt: t.lastActivityAt.toISOString(),
      lastSchoolActivityAt: t.lastSchoolActivityAt.toISOString(),
      lastOwnerActivityAt: t.lastOwnerActivityAt?.toISOString() ?? null,
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      closedAt: t.closedAt?.toISOString() ?? null,
      reopenedAt: t.reopenedAt?.toISOString() ?? null,
      unanswered: isUnanswered(t),
      lookInUntil: t.lookInUntil?.toISOString() ?? null,
      entryCount,
      raisedBy: { name: t.raisedBy.name ?? t.raisedBy.email },
      school: side === 'OWNER' ? { id: t.school.id, name: t.school.name, slug: t.school.slug, tier: t.school.tier } : null,
    };
  }

  private toDetail(
    t: TicketRecord & { body: string; attachmentKeys: string[]; context: unknown; externalRef: string | null; entries: EntryRecord[] },
    side: 'SCHOOL' | 'OWNER',
    assignedTo: { id: string; name: string } | null,
    sameModuleOpen: number,
  ): SupportTicketDetail {
    const entries = t.entries.filter((e) => (side === 'SCHOOL' ? e.visibleToSchool : true));
    return {
      ...this.toRow(t, side, entries.length),
      body: t.body,
      attachments: t.attachmentKeys.map(this.attachment),
      context: (t.context as SupportTicketContext | null) ?? null,
      entries: entries.map((e): SupportEntryRow => ({
        id: e.id,
        authorKind: e.authorKind as SupportEntryRow['authorKind'],
        authorName: e.authorName,
        body: e.body,
        attachments: e.attachmentKeys.map(this.attachment),
        visibleToSchool: e.visibleToSchool,
        statusFrom: (e.statusFrom as SupportStatus | null) ?? null,
        statusTo: (e.statusTo as SupportStatus | null) ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
      canReopen: side === 'SCHOOL' && canReopen(t.status as SupportStatus, t.resolvedAt),
      canConfirm: side === 'SCHOOL' && canConfirm(t.status as SupportStatus),
      assignedTo,
      externalRef: side === 'OWNER' ? t.externalRef : null,
      sameModuleOpen,
    };
  }

  private attachment = (key: string): SupportAttachment => ({ key, name: attachmentName(key) });

  private async ownerName(userId: string): Promise<string> {
    const u = await getPlatformPrisma().user.findFirst({ where: { id: userId, schoolId: null }, select: { name: true, email: true } });
    return u?.name ?? u?.email ?? 'Sckools';
  }

  private ownerUrl(id: string): string {
    const host = this.env.PLATFORM_OWNER_HOST;
    const local = host.endsWith('.localhost') || host === 'localhost';
    return `${local ? 'http' : 'https'}://${host}${local ? ':3000' : ''}/platform/support/${id}`;
  }

  /**
   * Tell the owner, by letter through the platform mailbox, at the address the
   * marketing config holds for callbacks. Post-commit and fire-and-forget: a
   * mailbox that is down must never undo the ticket it describes.
   */
  private async notifyOwner(kind: OwnerAlertKind, schoolId: string, id: string): Promise<void> {
    try {
      const to = (await this.marketing.getConfigRow()).contactEmail;
      if (!to) return;
      const db = getPlatformPrisma();
      const t = await db.supportTicket.findFirst({
        where: { id, schoolId },
        select: {
          number: true, title: true, body: true, type: true, module: true, severity: true,
          school: { select: { name: true } }, raisedBy: { select: { name: true, email: true } },
          entries: { where: { authorKind: 'SCHOOL' }, orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
        },
      });
      if (!t) return;
      const preview = kind === 'RAISED' ? t.body : (t.entries[0]?.body ?? t.body);
      const { subject, letter } = ownerAlertLetter(kind, {
        ticketNo: supportTicketNo(t.number),
        title: t.title,
        schoolName: t.school.name,
        severityLabel: SUPPORT_SEVERITY_LABEL[t.severity as SupportSeverity] ?? t.severity,
        moduleLabel: SUPPORT_MODULE_LABEL[t.module as SupportModule] ?? t.module,
        typeLabel: SUPPORT_TICKET_TYPE_LABEL[t.type as SupportTicketType] ?? t.type,
        by: t.raisedBy.name ?? t.raisedBy.email,
        preview: preview.slice(0, 600),
        url: this.ownerUrl(id),
      });
      await this.mail.sendLetter(to, null, subject, letter);
    } catch (e) {
      this.logger.warn(`support: owner alert for ${id} not sent: ${(e as Error).message}`);
    }
  }

  /** Tell the admin who raised it: an in-app row and an outbox row the drain turns into email and push. */
  private async notifySchool(kind: SchoolUpdateKind, schoolId: string, id: string, statusLabel?: string): Promise<void> {
    try {
      await withTenant(schoolId, async (tx) => {
        const [t, school] = await Promise.all([
          tx.supportTicket.findFirst({ where: { id, schoolId }, select: { number: true, title: true, raisedById: true } }),
          tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
        ]);
        if (!t) return;
        const { title, body } = schoolUpdateText(kind, { ticketNo: supportTicketNo(t.number), title: t.title, statusLabel });
        await tx.notification.create({
          data: { schoolId, userId: t.raisedById, kind: 'SUPPORT', title, body, linkType: 'support', linkId: id },
        });
        await tx.notificationOutbox.create({
          data: { schoolId, kind: 'SUPPORT_UPDATE', payload: { schoolName: school?.name ?? 'Your school', title, body }, targetUserId: t.raisedById },
          select: { id: true },
        });
      });
      requestOutboxDrain();
    } catch (e) {
      this.logger.warn(`support: school update for ${id} not written: ${(e as Error).message}`);
    }
  }
}

type TicketRecord = {
  id: string; number: number; type: string; module: string; severity: string; title: string; status: string;
  createdAt: Date; lastActivityAt: Date; lastSchoolActivityAt: Date; lastOwnerActivityAt: Date | null;
  resolvedAt: Date | null; closedAt: Date | null; reopenedAt: Date | null; lookInUntil: Date | null;
  raisedBy: { name: string | null; email: string };
  school: { id: string; name: string; slug: string; tier: string };
};
type EntryRecord = {
  id: string; authorKind: string; authorName: string | null; body: string; attachmentKeys: string[];
  visibleToSchool: boolean; statusFrom: string | null; statusTo: string | null; createdAt: Date;
};
