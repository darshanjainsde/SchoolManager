import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { MessagesService } from './messages.service';
import { TeacherReplyDto } from './messages.dto';

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
}
