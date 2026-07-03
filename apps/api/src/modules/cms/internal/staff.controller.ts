import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { StaffService } from './staff.service';
import { UpsertStaffDto } from './cms.dto';

@Controller('site/staff')
@UseGuards(SchoolJwtGuard)
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
