import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { NotificationsService } from './notifications.service';
import { MarkNotificationsReadDto } from './notifications.dto';

/**
 * The notification bell, for EVERY logged-in school user — student, teacher, or
 * admin (one screen, one endpoint set; only the rows differ per user). Unlike
 * the role-specific `/me/messages` (STUDENT) and `/manage/messages` (TEACHER)
 * surfaces, notifications are role-agnostic, so this controller admits all
 * in-app roles and scopes strictly by the caller's own `sub`.
 */
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('STUDENT', 'TEACHER', 'SCHOOL_ADMIN')
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // Declared BEFORE any param route so the static path always wins (same
  // ordering rule as `GET me/messages/teachers`).
  @Get('unread-count')
  unreadCount(@CurrentUser() u: SchoolJwtPayload) {
    return this.notifications.unreadCount(u.sub);
  }

  @Get()
  list(@CurrentUser() u: SchoolJwtPayload) {
    return this.notifications.list(u.sub);
  }

  @Post('read')
  markRead(@CurrentUser() u: SchoolJwtPayload, @Body() dto: MarkNotificationsReadDto) {
    return this.notifications.markRead(u.sub, dto.ids);
  }
}
