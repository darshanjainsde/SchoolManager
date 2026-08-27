import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { Public } from '../../../common/auth/public.decorator';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { JobsService } from './jobs.service';
import { ApplyDto, CreateJobDto, SetApplicationStatusDto, UpdateJobDto } from './hiring.dto';

/** The school's own vacancies and its applications desk. */
/** SchoolJwtGuard reads no role, so without RolesGuard every route here was
 *  reachable with a STUDENT or PARENT token. Every caller is under /app, which
 *  is already SCHOOL_ADMIN-only, so nothing legitimate loses access. */
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('HIRING')
@Roles('SCHOOL_ADMIN')
@Controller('manage/jobs')
export class ManageJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get() list() {
    return this.jobs.list();
  }

  @Post() create(@Body() dto: CreateJobDto) {
    return this.jobs.create(dto);
  }

  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJobDto) {
    return this.jobs.update(id, dto);
  }

  @Post(':id/submit') submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.submit(id);
  }

  @Post(':id/close') close(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.close(id);
  }

  /** The desk. Tenant-scoped — one school can never read another's candidates. */
  @Get(':id/applications') applications(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.applications(id);
  }

  @Patch('applications/:id') setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetApplicationStatusDto,
  ) {
    return this.jobs.setApplicationStatus(id, dto);
  }
}

/**
 * The board on sckools.com.
 *
 * That host resolves to the PLATFORM, not a school, so there is no tenant
 * context here and no feature guard to hang off one — the service reads only
 * APPROVED vacancies and never touches an applicant field on this path.
 */
@Controller('public/jobs')
export class PublicJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get()
  board(
    @Query('school') school?: string,
    @Query('employmentType') employmentType?: string,
    @Query('subject') subject?: string,
  ) {
    return this.jobs.publicBoard({ school, employmentType, subject });
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.publicOne(id);
  }

  /**
   * A stranger applying. Throttled like the enquiry form: a public POST that
   * writes a row is what a bored script finds first, and a desk with three
   * hundred fake candidates is as useless to a school as an empty one.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/apply')
  @HttpCode(201)
  apply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyDto) {
    return this.jobs.apply(id, dto);
  }
}
