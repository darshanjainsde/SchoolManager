import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { MessagesService } from './messages.service';
import { BlockThreadDto, ReportMessageDto, StudentSendMessageDto } from './messages.dto';

/**
 * Student side of messaging (Phase 4 Task 5 / T17) — `/me/messages`. A student
 * may only message a teacher who teaches them (enforced in the service from the
 * timetable, never from these ids). Sends are rate-limited so one student can't
 * spam a teacher.
 */
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('STUDENT')
@Controller('me/messages')
export class StudentMessagesController {
  constructor(private readonly messages: MessagesService) {}

  // Declared BEFORE the `:threadId` param route so the static path wins.
  @Get('teachers')
  teachers(@CurrentUser() u: SchoolJwtPayload) {
    return this.messages.messageableTeachers(u.sub);
  }

  // Static path — declared before `:threadId` so it isn't shadowed.
  @Get('unread-count')
  unreadCount(@CurrentUser() u: SchoolJwtPayload) {
    return this.messages.studentUnreadCount(u.sub);
  }

  @Get()
  list(@CurrentUser() u: SchoolJwtPayload) {
    return this.messages.studentThreads(u.sub);
  }

  @Get(':threadId')
  thread(@Param('threadId', ParseUUIDPipe) threadId: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.messages.studentThread(u.sub, threadId);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  send(@CurrentUser() u: SchoolJwtPayload, @Body() dto: StudentSendMessageDto) {
    return this.messages.studentSend(u.sub, dto);
  }

  /** Report this thread (or one message in it) to the school's admins. 201 {ok: true}.
   * Throttled like a send so a report can't be used to flood the office. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':threadId/report')
  report(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() u: SchoolJwtPayload,
    @Body() dto: ReportMessageDto,
  ) {
    return this.messages.studentReport(u.sub, threadId, dto);
  }

  /** Block / unblock this thread for the student/family side. 200 {blocked}. */
  @Post(':threadId/block')
  @HttpCode(200)
  block(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() u: SchoolJwtPayload,
    @Body() dto: BlockThreadDto,
  ) {
    return this.messages.studentBlock(u.sub, threadId, dto.blocked);
  }
}
