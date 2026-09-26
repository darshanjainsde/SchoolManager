import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { ConcernsService } from './concerns.service';
import { ConcernCommentDto, ConcernStatusDto, RaiseConcernDto, ReopenConcernDto } from './concerns.dto';

/**
 * THE COMPLAINT BOX — three doors onto one service, one per audience.
 *
 * The three are separate controllers rather than one with a role branch,
 * because the guard then states the audience: a STUDENT login simply cannot
 * reach the office's list, whatever it sends. The service still decides what
 * each viewer may SEE — the two checks are deliberately not the same one.
 */

@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
@Controller('manage/concerns')
export class AdminConcernsController {
  constructor(private readonly svc: ConcernsService, private readonly tenant: TenantContextService) {}
  private sid() { return this.tenant.requireTenant().schoolId; }

  @Get('counts') counts(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.counts(this.sid(), { kind: 'ADMIN', userId: u.sub });
  }

  @Get()
  list(@CurrentUser() u: SchoolJwtPayload, @Query('status') status?: string, @Query('category') category?: string, @Query('unread') unread?: string) {
    return this.svc.list(this.sid(), { kind: 'ADMIN', userId: u.sub }, { status, category, unreadOnly: unread === '1' });
  }

  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.detail(this.sid(), { kind: 'ADMIN', userId: u.sub }, id);
  }

  @Post(':id/comment')
  comment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConcernCommentDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.comment(this.sid(), { kind: 'ADMIN', userId: u.sub }, id, dto);
  }

  @Post(':id/status')
  status_(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConcernStatusDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.setStatus(this.sid(), { kind: 'ADMIN', userId: u.sub }, id, dto.status, dto.note);
  }
}

@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('TEACHER')
@Controller('teacher/concerns')
export class TeacherConcernsController {
  constructor(private readonly svc: ConcernsService, private readonly tenant: TenantContextService) {}
  private sid() { return this.tenant.requireTenant().schoolId; }

  @Get('counts') counts(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.counts(this.sid(), { kind: 'TEACHER', userId: u.sub });
  }

  @Get()
  list(@CurrentUser() u: SchoolJwtPayload, @Query('status') status?: string, @Query('unread') unread?: string) {
    return this.svc.list(this.sid(), { kind: 'TEACHER', userId: u.sub }, { status, unreadOnly: unread === '1' });
  }

  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.detail(this.sid(), { kind: 'TEACHER', userId: u.sub }, id);
  }

  @Post(':id/comment')
  comment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConcernCommentDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.comment(this.sid(), { kind: 'TEACHER', userId: u.sub }, id, dto);
  }

  @Post(':id/status')
  status_(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConcernStatusDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.setStatus(this.sid(), { kind: 'TEACHER', userId: u.sub }, id, dto.status, dto.note);
  }

  /** One way: after this the office can see it too, and the teacher keeps it. */
  @Post(':id/escalate')
  escalate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.escalate(this.sid(), { kind: 'TEACHER', userId: u.sub }, id);
  }
}

@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('STUDENT')
@Controller('me/concerns')
export class FamilyConcernsController {
  constructor(private readonly svc: ConcernsService, private readonly tenant: TenantContextService) {}
  private sid() { return this.tenant.requireTenant().schoolId; }

  @Get() list(@CurrentUser() u: SchoolJwtPayload, @Query('status') status?: string) {
    return this.svc.list(this.sid(), { kind: 'FAMILY', userId: u.sub }, { status });
  }

  @Post() raise(@Body() dto: RaiseConcernDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.raise(this.sid(), u.sub, dto);
  }

  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.detail(this.sid(), { kind: 'FAMILY', userId: u.sub }, id);
  }

  @Post(':id/comment')
  comment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConcernCommentDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.comment(this.sid(), { kind: 'FAMILY', userId: u.sub }, id, dto);
  }

  @Post(':id/reopen')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenConcernDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.reopen(this.sid(), u.sub, id, dto.body);
  }
}
