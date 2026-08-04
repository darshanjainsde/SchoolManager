import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { DiaryService } from './diary.service';
import { CreateDiaryEntryDto, UpdateDiaryEntryDto } from './management.dto';

/**
 * The teacher's side of the Daily Diary. The family's side lives on
 * `/me/diary` in `PortalController`; the attendance bar that shares this
 * phase's pitch lives on `AttendanceController`, next to the register it
 * reads from.
 */
@Controller('manage')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('TEACHER', 'SCHOOL_ADMIN')
export class DiaryController {
  constructor(
    private readonly diary: DiaryService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  /** One class's diary page for one day. */
  @Get('diary')
  page(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Query('date') date: string,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.diary.page(this.sid(), classSectionId, date, u.sub, u.role);
  }

  @Post('diary')
  create(@Body() dto: CreateDiaryEntryDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.diary.create(this.sid(), u.sub, u.role, dto);
  }

  @Patch('diary/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiaryEntryDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.diary.update(this.sid(), u.sub, u.role, id, dto);
  }

  @Delete('diary/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.diary.remove(this.sid(), u.sub, u.role, id);
  }
}
