import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { DesignDraftsService } from './design-drafts.service';
import { UpsertDesignDraftDto } from './cms.dto';

@Controller('site/design-drafts')
@UseGuards(SchoolJwtGuard, RolesGuard)
// SchoolJwtGuard establishes WHICH school you belong to; it reads no role at
// all. Without RolesGuard beside it, "publish this draft to the live site" was
// reachable with a STUDENT token. Class-level, not per-handler: this is the
// shape that let StaffController ship with two of six handlers guarded.
@Roles('SCHOOL_ADMIN')
export class DesignDraftsController {
  constructor(
    private readonly drafts: DesignDraftsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.drafts.list(this.sid());
  }

  @Post()
  create(@Body() dto: UpsertDesignDraftDto) {
    return this.drafts.create(this.sid(), dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpsertDesignDraftDto) {
    return this.drafts.update(this.sid(), id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.drafts.remove(this.sid(), id);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.drafts.publish(this.sid(), id);
  }
}
