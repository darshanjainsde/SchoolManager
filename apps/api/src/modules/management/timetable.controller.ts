import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { TimetableService } from './timetable.service';
import { AssignSlotDto, AvailabilityQueryDto } from './management.dto';

@Controller('manage/timetable')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class TimetableController {
  constructor(
    private readonly timetable: TimetableService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get()
  listForClass(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Query('date') date?: string,
  ) {
    return this.timetable.listForClass(this.sid(), classSectionId, date);
  }

  @Post()
  assign(@Body() dto: AssignSlotDto) {
    return this.timetable.assign(this.sid(), dto);
  }

  @Delete(':id')
  @HttpCode(204)
  unassign(@Param('id', ParseUUIDPipe) id: string) {
    return this.timetable.unassign(this.sid(), id);
  }
}
