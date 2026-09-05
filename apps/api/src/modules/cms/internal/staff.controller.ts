import { SitePurgeInterceptor } from './site-purge.interceptor';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards , UseInterceptors } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { StaffService } from './staff.service';
import { UpsertStaffDto } from './cms.dto';

@Controller('site/staff')
// Any write here drops this school's cached pages — see the interceptor.
@UseInterceptors(SitePurgeInterceptor)
// SchoolJwtGuard establishes WHICH school you belong to; it reads no role at
// all. Without RolesGuard beside it every route here was reachable with a
// STUDENT or PARENT token — and the enquiries ones hand back other families'
// names and phone numbers. Every caller lives under /app, which is already
// SCHOOL_ADMIN-only, so this locks out nobody who was legitimately using it.
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.staff.list(this.sid());
  }

  @Post()
  create(@Body() dto: UpsertStaffDto) {
    return this.staff.create(this.sid(), dto);
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertStaffDto) {
    return this.staff.update(this.sid(), id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.remove(this.sid(), id);
  }
}
