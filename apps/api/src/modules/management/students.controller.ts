import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { StudentsService } from './students.service';
import { CreateStudentDto, UpdateStudentDto } from './management.dto';

@Controller('manage/students')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list(
    @Query('classSectionId', new ParseUUIDPipe({ optional: true }))
    classSectionId?: string,
  ) {
    return this.students.list(this.sid(), { classSectionId });
  }

  @Post()
  create(@Body() dto: CreateStudentDto) {
    return this.students.create(this.sid(), dto);
  }

  @Post(':id/login')
  createLogin(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.createLogin(this.sid(), id);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.students.update(this.sid(), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.remove(this.sid(), id);
  }
}
