import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { DesignDraftsService } from './design-drafts.service';
import { UpsertDesignDraftDto } from './cms.dto';

@Controller('site/design-drafts')
@UseGuards(SchoolJwtGuard)
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
