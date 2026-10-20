import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { MessagesService } from './messages.service';
import { BlockThreadDto, ReportMessageDto, TeacherReplyDto } from './messages.dto';

/**
 * Teacher side of messaging (Phase 4 Task 5 / T17) — `/manage/messages`. A
 * teacher only ever sees/acts on threads whose stored `teacherId` is their own
 * (enforced in the service from the STORED thread, never caller input).
 */
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('TEACHER')
@Controller('manage/messages')
export class TeacherMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@CurrentUser() u: SchoolJwtPayload) {
    return this.messages.teacherThreads(u.sub);
  }

  // Static path — declared before `:threadId` so it isn't shadowed.
  @Get('unread-count')
  unreadCount(@CurrentUser() u: SchoolJwtPayload) {
    return this.messages.teacherUnreadCount(u.sub);
  }

  @Get(':threadId')
  thread(@Param('threadId', ParseUUIDPipe) threadId: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.messages.teacherThread(u.sub, threadId);
  }

  @Post(':threadId')
  reply(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() u: SchoolJwtPayload,
    @Body() dto: TeacherReplyDto,
  ) {
    return this.messages.teacherReply(u.sub, threadId, dto);
  }

  /** Report this thread (or one message in it) to the school's admins. 201 {ok: true}. */
  // Throttled like the family side, so a report can't flood the office from either end.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':threadId/report')
  report(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() u: SchoolJwtPayload,
    @Body() dto: ReportMessageDto,
  ) {
    return this.messages.teacherReport(u.sub, threadId, dto);
  }

  /** Block / unblock this thread for the teacher's side. 200 {blocked}. */
  @Post(':threadId/block')
  @HttpCode(200)
  block(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() u: SchoolJwtPayload,
    @Body() dto: BlockThreadDto,
  ) {
    return this.messages.teacherBlock(u.sub, threadId, dto.blocked);
  }
}
