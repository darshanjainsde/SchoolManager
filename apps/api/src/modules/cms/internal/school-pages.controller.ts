import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { SchoolPagesService } from './school-pages.service';
import { UpsertSchoolPageDto } from './cms.dto';

@Controller('site/pages')
@UseGuards(SchoolJwtGuard)
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
