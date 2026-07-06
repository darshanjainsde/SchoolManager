import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { CoursesService } from './courses.service';
import { UpsertCourseDto, UpsertCourseFeeDto } from './cms.dto';

@Controller('site/courses')
@UseGuards(SchoolJwtGuard)
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.courses.list(this.sid());
  }

  @Post()
  create(@Body() dto: UpsertCourseDto) {
    return this.courses.create(this.sid(), dto);
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertCourseDto) {
    return this.courses.update(this.sid(), id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.courses.remove(this.sid(), id);
  }

  @Put(':id/fee')
  setFee(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertCourseFeeDto) {
    return this.courses.setFee(this.sid(), id, dto);
  }
}
