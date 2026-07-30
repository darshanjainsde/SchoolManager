import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './management.dto';

@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller('manage/announcements')
export class AnnouncementsController {
  constructor(
    private readonly svc: AnnouncementsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Roles('SCHOOL_ADMIN')
  @Get()
  list() {
    return this.svc.list(this.sid());
  }

  // Declared ABOVE the `:id` routes below — a literal path segment like
  // `mine` must be registered before any `:id` route sharing its HTTP
  // method, or the router would try to parse "mine" as a UUID `:id` instead.
  // (No `@Get(':id')` exists today, but this keeps the ordering correct if
  // one is ever added.)
  @Roles('TEACHER')
  @Get('mine')
  mine(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.mine(this.sid(), u.sub);
  }

  // TEACHER may create too — restricted to their own class sections
  // (AnnouncementsService.create enforces this via AttendanceService.myClassSections).
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Post()
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.create(this.sid(), u.sub, u.role, dto);
  }

  // TEACHER may edit too — AnnouncementsService.update allows it only on rows
  // the caller authored (resolved from the stored row); SCHOOL_ADMIN is unrestricted.
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.svc.update(this.sid(), id, dto, { userId: u.sub, role: u.role });
  }

  // Same authorship rule as update() above.
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.remove(this.sid(), id, { userId: u.sub, role: u.role });
  }
}
