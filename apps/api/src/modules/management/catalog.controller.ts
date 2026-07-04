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
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { CatalogService } from './catalog.service';
import { TimetableService } from './timetable.service';
import {
  AvailabilityQueryDto,
  CreateGradeDto,
  CreatePeriodDto,
  CreateSubjectDto,
  CreateYearDto,
  UpdateGradeDto,
  UpdatePeriodDto,
  UpdateSubjectDto,
} from './management.dto';

@Controller('manage')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard)
@RequireFeature('MANAGEMENT')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly timetable: TimetableService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // ── Academic Years ─────────────────────────────────────────────────────────

  @Get('years')
  listYears() {
    return this.catalog.listYears(this.sid());
  }

  @Post('years')
  createYear(@Body() dto: CreateYearDto) {
    return this.catalog.createYear(this.sid(), dto);
  }

  // ── Grades ─────────────────────────────────────────────────────────────────

  @Get('grades')
  listGrades() {
    return this.catalog.listGrades(this.sid());
  }

  @Post('grades')
  createGrade(@Body() dto: CreateGradeDto) {
    return this.catalog.createGrade(this.sid(), dto);
  }

  @Put('grades/:id')
  updateGrade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeDto,
  ) {
    return this.catalog.updateGrade(this.sid(), id, dto);
  }

  @Delete('grades/:id')
  @HttpCode(204)
  deleteGrade(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteGrade(this.sid(), id);
  }

  // ── Subjects ───────────────────────────────────────────────────────────────

  @Get('subjects')
  listSubjects() {
    return this.catalog.listSubjects(this.sid());
  }

  @Post('subjects')
  createSubject(@Body() dto: CreateSubjectDto) {
    return this.catalog.createSubject(this.sid(), dto);
  }

  @Put('subjects/:id')
  updateSubject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.catalog.updateSubject(this.sid(), id, dto);
  }

  @Delete('subjects/:id')
  @HttpCode(204)
  deleteSubject(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteSubject(this.sid(), id);
  }

  // ── Periods ────────────────────────────────────────────────────────────────

  @Get('periods')
  listPeriods() {
    return this.catalog.listPeriods(this.sid());
  }

  @Post('periods')
  createPeriod(@Body() dto: CreatePeriodDto) {
    return this.catalog.createPeriod(this.sid(), dto);
  }

  @Put('periods/:id')
  updatePeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodDto,
  ) {
    return this.catalog.updatePeriod(this.sid(), id, dto);
  }

  @Delete('periods/:id')
  @HttpCode(204)
  deletePeriod(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deletePeriod(this.sid(), id);
  }

  // ── Availability ───────────────────────────────────────────────────────────

  @Get('availability')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.timetable.availability(this.sid(), query);
  }
}
