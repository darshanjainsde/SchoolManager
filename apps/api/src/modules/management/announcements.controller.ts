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

  // TEACHER may create too — restricted to their own class sections
  // (AnnouncementsService.create enforces this via AttendanceService.myClassSections).
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Post()
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.create(this.sid(), u.sub, u.role, dto);
  }

  @Roles('SCHOOL_ADMIN')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.svc.update(this.sid(), id, dto);
  }

  @Roles('SCHOOL_ADMIN')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(this.sid(), id);
  }
}
