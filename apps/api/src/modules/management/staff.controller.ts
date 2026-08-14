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

/**
 * The school's staff records. SCHOOL_ADMIN only, every route.
 *
 * `RolesGuard` used to sit on the two login-invite handlers alone, with a note
 * calling the rest "intentionally open to any authenticated MANAGEMENT-feature
 * role". That was not a policy, it was a hole: `RequireFeatureGuard` asks
 * whether the SCHOOL bought the feature and never who is asking, and the only
 * `APP_GUARD` in `app.module.ts` is `ThrottlerGuard`. So a STUDENT token read
 * the staff roster with its emails and phone numbers, and a TEACHER token
 * reached `DELETE /manage/staff/:id`.
 *
 * Watched fail before the fix (`management-authz.e2e-spec.ts`): the DELETE
 * answered **404, not 403** — authorization never ran, the handler simply did
 * not find that row. A real id would have deleted it.
 *
 * Nothing else called these: the admin console at `app/app/staff/page.tsx` is
 * the only client, and `/manage/staff-attendance/*` — which STAFF and the
 * mobile worker portal do call — is a different controller with its own guards.
 */
@Controller('manage/staff')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
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
   * Creates the staff member's login. `dto.role` is `STAFF` or `LIBRARIAN`
   * only — `management.dto.ts` pins that with `@IsIn`, which is what stops a
   * staff screen from minting a TEACHER or a SCHOOL_ADMIN.
   */
  @Post(':id/login')
  createLogin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateLoginDto) {
    return this.staff.createLogin(this.sid(), id, dto);
  }

  @Post(':id/invite/resend')
  resendInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.resendInvite(this.sid(), id);
  }
}
