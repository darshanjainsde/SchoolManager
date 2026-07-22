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
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { TeachersService } from './teachers.service';
import { CreateLoginDto, CreateTeacherDto, UpdateTeacherDto } from './management.dto';

@Controller('manage/teachers')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard)
@RequireFeature('MANAGEMENT')
export class TeachersController {
  constructor(
    private readonly teachers: TeachersService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.teachers.list(this.sid());
  }

  @Post()
  create(@Body() dto: CreateTeacherDto) {
    return this.teachers.create(this.sid(), dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
  ) {
    return this.teachers.update(this.sid(), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.teachers.remove(this.sid(), id);
  }

  /**
   * Login-invite routes are SCHOOL_ADMIN-only (mirrors StudentsController),
   * so RolesGuard + @Roles are applied per-handler here rather than at the
   * class level — the other handlers on this controller intentionally stay
   * open to any authenticated MANAGEMENT-feature role (e.g. TEACHER reads
   * `/manage/teachers` from the classes/timetable pages).
   */
  @Post(':id/login')
  @UseGuards(RolesGuard)
  @Roles('SCHOOL_ADMIN')
  createLogin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateLoginDto) {
    return this.teachers.createLogin(this.sid(), id, dto);
  }

  @Post(':id/invite/resend')
  @UseGuards(RolesGuard)
  @Roles('SCHOOL_ADMIN')
  resendInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.teachers.resendInvite(this.sid(), id);
  }
}
