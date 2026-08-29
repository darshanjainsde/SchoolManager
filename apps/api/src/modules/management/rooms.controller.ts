import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { RoomsService } from './rooms.service';
import { SaveRoomDto } from './management.dto';

/**
 * The school's rooms — the only thing the exam screen asks a school to supply.
 * Recorded once and reused by every sitting after that.
 */
@Controller('manage/rooms')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class RoomsController {
  constructor(
    private readonly svc: RoomsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.svc.list(this.sid());
  }

  @Post()
  create(@Body() dto: SaveRoomDto) {
    return this.svc.create(this.sid(), dto);
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveRoomDto) {
    return this.svc.update(this.sid(), id, dto);
  }

  /** Fourteen classrooms of the same shape is the normal case, not the rare one. */
  @Post(':id/duplicate')
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.duplicate(this.sid(), id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(this.sid(), id);
  }
}
