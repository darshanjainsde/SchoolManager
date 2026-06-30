import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable, fromEventPattern, map } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { Prisma, UserRole, withTenant } from '@skoolos/db';
import type { Response } from 'express';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import { CreateAnnouncementDto, SendMessageDto } from './comms.dto';
import { SseBusService } from './sse-bus.service';

@ApiTags('comms')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller()
export class CommsController {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly bus: SseBusService,
  ) {}

  // ── Announcements ─────────────────────────────────────────────────────
  @Get('announcements')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.STAFF)
  async listAnnouncements(@CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      // Compute which CLASS audiences this user can see.
      let classIds: string[] = [];
      if (user.role === UserRole.STUDENT) {
        const enrolls = await tx.enrollment.findMany({
          where: { studentUserId: user.sub, status: 'ACTIVE' },
          select: { classId: true },
        });
        classIds = enrolls.map((e) => e.classId);
      } else if (user.role === UserRole.TEACHER) {
        const csts = await tx.classSubjectTeacher.findMany({
          where: { teacherUserId: user.sub },
          select: { classId: true },
        });
        classIds = Array.from(new Set(csts.map((c) => c.classId)));
      }
      return tx.announcement.findMany({
        where: {
          OR: [
            { audience: 'SCHOOL' },
            { audience: 'ROLE', audienceRole: user.role },
            { audience: 'USER', audienceUserId: user.sub },
            { audience: 'CLASS', audienceClassId: { in: classIds.length > 0 ? classIds : ['00000000-0000-0000-0000-000000000000'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  }

  @Post('announcements')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async createAnnouncement(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    if (dto.audience === 'ROLE' && !dto.audienceRole) throw new BadRequestException('audienceRole required');
    if (dto.audience === 'CLASS' && !dto.audienceClassId) throw new BadRequestException('audienceClassId required');
    if (dto.audience === 'USER' && !dto.audienceUserId) throw new BadRequestException('audienceUserId required');

    const created = await withTenant(schoolId, (tx) =>
      tx.announcement.create({
        data: {
          schoolId,
          authorUserId: user.sub,
          audience: dto.audience,
          audienceRole: dto.audienceRole,
          audienceClassId: dto.audienceClassId,
          audienceUserId: dto.audienceUserId,
          title: dto.title,
          body: dto.body,
        },
      }),
    );
    // Fan-out: pick the right scope so SSE subscribers only get what they should.
    const scope =
      dto.audience === 'SCHOOL' ? 'announce:school' :
      dto.audience === 'ROLE' ? `announce:role:${dto.audienceRole}` :
      dto.audience === 'CLASS' ? `announce:class:${dto.audienceClassId}` :
      `announce:user:${dto.audienceUserId}`;
    this.bus.publish(schoolId, scope, { type: 'announcement', payload: created });

    // Also create per-user Notifications when audience is USER (so they see it in their feed).
    if (dto.audience === 'USER' && dto.audienceUserId) {
      await withTenant(schoolId, (tx) =>
        tx.notification.create({
          data: {
            schoolId,
            userId: dto.audienceUserId!,
            title: dto.title,
            body: dto.body,
            kind: 'announcement',
            payload: { announcementId: created.id } as Prisma.InputJsonValue,
          },
        }),
      );
    }
    return created;
  }

  // ── Notifications (per-user inbox) ────────────────────────────────────
  @Get('notifications')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.STAFF)
  async listNotifications(@CurrentUser() user: SchoolJwtPayload, @Query('unread') unread?: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.notification.findMany({
        where: { userId: user.sub, ...(unread === '1' ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  @Patch('notifications/:id/read')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.STAFF)
  async markRead(@Param('id') id: string, @CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const n = await tx.notification.findUnique({ where: { id } });
      if (!n || n.userId !== user.sub) throw new NotFoundException();
      return tx.notification.update({ where: { id }, data: { readAt: new Date() } });
    });
  }

  // ── Messages (1:1 threads) ────────────────────────────────────────────
  @Get('messages/threads/:threadId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.STAFF)
  async thread(@Param('threadId') threadId: string, @CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.message.findMany({
        where: { threadId, OR: [{ fromUserId: user.sub }, { toUserId: user.sub }] },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  @Post('messages')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.STAFF)
  async send(@Body() dto: SendMessageDto, @CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    if (dto.toUserId === user.sub) throw new BadRequestException('Cannot message yourself');
    // Validate the recipient is actually a user in this tenant. Without this
    // check, schema would silently allow messages with arbitrary toUserId
    // values — they'd just be invisible to the (nonexistent) recipient.
    const msg = await withTenant(schoolId, async (tx) => {
      const recipient = await tx.user.findUnique({ where: { id: dto.toUserId } });
      if (!recipient) throw new BadRequestException('Recipient not found in this school');
      const threadId = dto.threadId ?? randomUUID();
      return tx.message.create({
        data: {
          schoolId,
          threadId,
          fromUserId: user.sub,
          toUserId: dto.toUserId,
          body: dto.body,
        },
      });
    });
    // Realtime push to the recipient.
    this.bus.publish(schoolId, `user:${dto.toUserId}`, { type: 'message', payload: msg });
    return msg;
  }

  // ── SSE realtime stream for the logged-in user ────────────────────────
  // Each connection consumes one throttler token at the GET — after that it's
  // a long-lived stream. With the default 100 req/min/IP a user can open 100
  // concurrent SSE streams per minute, which is more than enough headroom.
  @Sse('events/stream')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT, UserRole.STAFF)
  stream(@CurrentUser() user: SchoolJwtPayload, @Res() res?: Response): Observable<MessageEvent> {
    const { schoolId } = this.tenantCtx.requireTenant();
    if (res && typeof res.flushHeaders === 'function') {
      // Some proxies buffer SSE; ask them not to.
      res.setHeader('X-Accel-Buffering', 'no');
    }
    return fromEventPattern<{ type: string; payload: unknown }>(
      (h) => {
        const unsubs: Array<() => void> = [];
        // Subscribe to all scopes that apply to this user.
        unsubs.push(this.bus.subscribe(schoolId, 'announce:school', h));
        unsubs.push(this.bus.subscribe(schoolId, `announce:role:${user.role}`, h));
        unsubs.push(this.bus.subscribe(schoolId, `announce:user:${user.sub}`, h));
        unsubs.push(this.bus.subscribe(schoolId, `user:${user.sub}`, h));
        // Stash for teardown.
        (h as unknown as { _unsubs?: Array<() => void> })._unsubs = unsubs;
      },
      (h) => {
        const unsubs = (h as unknown as { _unsubs?: Array<() => void> })._unsubs ?? [];
        unsubs.forEach((u) => u());
      },
    ).pipe(map((ev) => ({ data: ev }) as MessageEvent));
  }
}
