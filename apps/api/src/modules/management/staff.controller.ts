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
import { StaffService } from './staff.service';
import { CreateLoginDto, CreateStaffDto, UpdateStaffDto } from './management.dto';

@Controller('manage/staff')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard)
@RequireFeature('MANAGEMENT')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.staff.list(this.sid());
  }

  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(this.sid(), dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(this.sid(), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.remove(this.sid(), id);
  }

  /**
   * Login-invite routes are SCHOOL_ADMIN-only (mirrors TeachersController),
   * so RolesGuard + @Roles are applied per-handler here rather than at the
   * class level — the other handlers on this controller intentionally stay
   * open to any authenticated MANAGEMENT-feature role.
   */
  @Post(':id/login')
  @UseGuards(RolesGuard)
  @Roles('SCHOOL_ADMIN')
  createLogin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateLoginDto) {
    return this.staff.createLogin(this.sid(), id, dto);
  }

  @Post(':id/invite/resend')
  @UseGuards(RolesGuard)
  @Roles('SCHOOL_ADMIN')
  resendInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.resendInvite(this.sid(), id);
  }
}
