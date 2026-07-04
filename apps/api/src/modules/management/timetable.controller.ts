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
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { TimetableService } from './timetable.service';
import { AssignSlotDto, AvailabilityQueryDto } from './management.dto';

@Controller('manage/timetable')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard)
@RequireFeature('MANAGEMENT')
export class TimetableController {
  constructor(
    private readonly timetable: TimetableService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  listForClass(@Query('classSectionId', ParseUUIDPipe) classSectionId: string) {
    return this.timetable.listForClass(this.sid(), classSectionId);
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
