import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { MessagesService } from './messages.service';
import { StudentSendMessageDto } from './messages.dto';

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
}
