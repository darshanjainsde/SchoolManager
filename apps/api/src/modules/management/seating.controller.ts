import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { SeatingService } from './seating.service';
import { PreviewSeatingDto, SaveSeatingDto } from './management.dto';

/**
 * Seating charts. `preview` generates without writing, because the office
 * presses the button, looks at the hall, and only then decides.
 */
@Controller('manage/seating')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class SeatingController {
  constructor(
    private readonly svc: SeatingService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.svc.list(this.sid());
  }

  /** Generates a chart and writes nothing. */
  @Post('preview')
  preview(@Body() dto: PreviewSeatingDto) {
    return this.svc.preview(this.sid(), dto);
  }

  @Post()
  save(@Body() dto: SaveSeatingDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.save(this.sid(), dto, u.sub);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(this.sid(), id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(this.sid(), id);
  }
}
