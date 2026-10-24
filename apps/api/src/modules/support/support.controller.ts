import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SUPPORT_MAX_FILES, SUPPORT_MAX_FILE_BYTES } from '@skoolos/types';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { PlatformJwtPayload, SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { OwnerHostGuard } from '../../common/auth/owner-host.guard';
import { PlatformJwtGuard } from '../../common/auth/platform-jwt.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { TenantContextService } from '../tenancy';
import {
  AssignDto, CreateTicketDto, LookInDto, OwnerCommentDto, OwnerStatusDto, PatchTicketDto, ReopenDto, SchoolCommentDto,
} from './support.dto';
import { SupportService, type UploadedImage } from './support.service';

/**
 * THE SUPPORT DESK — two doors onto one service.
 *
 * The school admin's door lives under `manage/` with the school JWT and the
 * SCHOOL_ADMIN role, like every other office desk. The owner's door lives
 * under `owner/` behind the owner host and the platform JWT, like print
 * orders and backups. Two controllers rather than one with a branch, so the
 * guard states the audience and a tenant credential opens nothing on the
 * platform side. The service still decides what each side may SEE.
 */

const photos = () =>
  UseInterceptors(FilesInterceptor('files', SUPPORT_MAX_FILES, { limits: { fileSize: SUPPORT_MAX_FILE_BYTES, files: SUPPORT_MAX_FILES } }));

const asImages = (files?: Express.Multer.File[]): UploadedImage[] =>
  (files ?? []).map((f) => ({ originalname: f.originalname, buffer: f.buffer, mimetype: f.mimetype }));

@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
@Controller('manage/support')
export class SchoolSupportController {
  constructor(private readonly svc: SupportService, private readonly tenant: TenantContextService) {}
  private v(u: SchoolJwtPayload) { return { schoolId: this.tenant.requireTenant().schoolId, userId: u.sub }; }

  @Get('counts') counts(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.schoolCounts(this.v(u));
  }

  @Get()
  list(@CurrentUser() u: SchoolJwtPayload, @Query('status') status?: string) {
    const s = status === 'CLOSED' || status === 'ALL' ? status : 'OPEN';
    return this.svc.schoolList(this.v(u), s);
  }

  /** Raise a ticket: fields plus up to five photos, as one multipart form. */
  @Post() @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @photos()
  create(
    @CurrentUser() u: SchoolJwtPayload,
    @Body() dto: CreateTicketDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Req() req: Request,
  ) {
    const ua = req.headers['user-agent'];
    return this.svc.create(this.v(u), dto, asImages(files), { userAgent: typeof ua === 'string' ? ua : null });
  }

  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.schoolDetail(this.v(u), id);
  }

  // Each reply can mail the owner; a burst is coalesced there, and this caps the rest.
  @Post(':id/comment') @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @photos()
  comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SchoolCommentDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.svc.schoolComment(this.v(u), id, dto.body, asImages(files));
  }

  /** "Yes, it's fixed." */
  @Post(':id/confirm') @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.confirm(this.v(u), id);
  }

  @Post(':id/reopen') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.reopen(this.v(u), id, dto.body);
  }

  /** Allow, or withdraw, Sckools opening the console to investigate. */
  @Post(':id/look-in') @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  lookIn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LookInDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.setLookIn(this.v(u), id, dto.allow);
  }

  /** A short-lived link to one photo on this ticket. */
  @Get(':id/file')
  file(@Param('id', ParseUUIDPipe) id: string, @Query('key') key: string | undefined, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.schoolFile(this.v(u), id, key ?? '');
  }
}

@Controller('owner/support')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class OwnerSupportController {
  constructor(private readonly svc: SupportService) {}
  private o(u: PlatformJwtPayload) { return { userId: u.sub }; }

  /** The sidebar badge: how many tickets the school moved last on. */
  @Get('counts') counts() {
    return this.svc.ownerCounts();
  }

  /** Every school's open tickets, oldest unanswered first. */
  @Get('board') board() {
    return this.svc.ownerBoard();
  }

  @Get('tickets')
  tickets(
    @Query('schoolId', new ParseUUIDPipe({ optional: true })) schoolId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('module') module?: string,
  ) {
    return this.svc.ownerList({ schoolId, status, type, module });
  }

  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: PlatformJwtPayload) {
    return this.svc.ownerDetail(this.o(u), id);
  }

  @Post(':id/status') @HttpCode(200)
  status_(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OwnerStatusDto, @CurrentUser() u: PlatformJwtPayload) {
    return this.svc.ownerStatus(this.o(u), id, dto.status, dto.note);
  }

  @Post(':id/comment') @HttpCode(200)
  comment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OwnerCommentDto, @CurrentUser() u: PlatformJwtPayload) {
    return this.svc.ownerComment(this.o(u), id, dto.body, dto.visibleToSchool !== false);
  }

  @Post(':id/assign') @HttpCode(200)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @CurrentUser() u: PlatformJwtPayload) {
    return this.svc.ownerAssign(this.o(u), id, dto.assign);
  }

  @Patch(':id')
  patch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchTicketDto, @CurrentUser() u: PlatformJwtPayload) {
    return this.svc.ownerPatch(this.o(u), id, dto.externalRef);
  }

  /** "Open as this school" — only while the school's consent clock is running. */
  @Post(':id/open-school') @HttpCode(200)
  openSchool(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: PlatformJwtPayload) {
    return this.svc.openSchool(this.o(u), id);
  }

  @Get(':id/file')
  file(@Param('id', ParseUUIDPipe) id: string, @Query('key') key: string | undefined) {
    return this.svc.ownerFile(id, key ?? '');
  }
}
