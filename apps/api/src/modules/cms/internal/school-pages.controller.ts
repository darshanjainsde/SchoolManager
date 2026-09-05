import { SitePurgeInterceptor } from './site-purge.interceptor';
import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards , UseInterceptors } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { SchoolPagesService } from './school-pages.service';
import { UpsertSchoolPageDto } from './cms.dto';

@Controller('site/pages')
// Any write here drops this school's cached pages — see the interceptor.
@UseInterceptors(SitePurgeInterceptor)
@UseGuards(SchoolJwtGuard, RolesGuard)
// SchoolJwtGuard establishes WHICH school you belong to; it reads no role at
// all. Without RolesGuard beside it, "publish this draft to the live site" was
// reachable with a STUDENT token. Class-level, not per-handler: this is the
// shape that let StaffController ship with two of six handlers guarded.
@Roles('SCHOOL_ADMIN')
export class SchoolPagesController {
  constructor(
    private readonly pages: SchoolPagesService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.pages.list(this.sid());
  }

  @Post()
  create(@Body() dto: UpsertSchoolPageDto) {
    return this.pages.create(this.sid(), dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpsertSchoolPageDto) {
    return this.pages.update(this.sid(), id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pages.remove(this.sid(), id);
  }
}
