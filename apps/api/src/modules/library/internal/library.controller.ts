import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Public } from '../../../common/auth/public.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { ApiError } from '../../../common/errors/api-error';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { TenantContextService } from '../../tenancy';
import { CronSecretGuard } from '../../management';
import { LibrarianGuard } from './librarian.guard';
import { LibraryCatalogService } from './library-catalog.service';
import { LibraryCirculationService } from './library-circulation.service';
import { LibraryDueSoonService } from './library-due-soon.service';
import { LibraryFinesService } from './library-fines.service';
import { LibraryHallService } from './library-hall.service';
import { LibraryMeService } from './library-me.service';
import { LibrarySettingsService } from './library-settings.service';
import {
  CreateTitleDto,
  IssueDto,
  RemindFinesDto,
  SaveHallVisitDto,
  UpdateLibrarySettingsDto,
} from './library.dto';

/**
 * The librarian's portal API. `RolesGuard` narrows to STAFF | SCHOOL_ADMIN,
 * then `LibrarianGuard` narrows STAFF further to the one with
 * `Staff.role = LIBRARIAN` — office staff and drivers bounce here.
 */
@Controller('library')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard, LibrarianGuard)
@RequireFeature('LIBRARY')
@Roles('STAFF', 'SCHOOL_ADMIN')
export class LibraryController {
  constructor(
    private readonly settings: LibrarySettingsService,
    private readonly catalog: LibraryCatalogService,
    private readonly circulation: LibraryCirculationService,
    private readonly fines: LibraryFinesService,
    private readonly hall: LibraryHallService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // ── Dashboard ───────────────────────────────────────────

  @Get('dashboard')
  dashboard() {
    return this.circulation.dashboard(this.sid());
  }

  // ── Settings ────────────────────────────────────────────

  @Get('settings')
  getSettings() {
    return this.settings.get(this.sid());
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateLibrarySettingsDto) {
    return this.settings.update(this.sid(), dto);
  }

  // ── Catalogue ───────────────────────────────────────────

  @Get('titles')
  searchTitles(@Query('q') q = '') {
    return this.catalog.search(this.sid(), q);
  }

  @Get('titles/:id')
  getTitle(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getTitle(this.sid(), id);
  }

  @Post('titles')
  createTitle(@Body() dto: CreateTitleDto) {
    return this.catalog.createTitle(this.sid(), dto);
  }

  @Post('titles/:id/copies')
  addCopy(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.addCopy(this.sid(), id);
  }

  // ── Members ─────────────────────────────────────────────

  @Get('members')
  memberSearch(@Query('q') q = '') {
    return this.circulation.memberSearch(this.sid(), q);
  }

  @Get('members/:kind/:id')
  memberCard(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    if (kind !== 'student' && kind !== 'teacher') {
      throw new ApiError('VALIDATION', 'kind must be student or teacher.', 400);
    }
    return this.circulation.memberCard(this.sid(), kind === 'student' ? 'STUDENT' : 'TEACHER', id);
  }

  // ── Counter ─────────────────────────────────────────────

  @Post('issues')
  issue(@Body() dto: IssueDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.circulation.issue(this.sid(), u.sub, dto);
  }

  @Post('issues/:id/return')
  returnIssue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.circulation.returnIssue(this.sid(), u.sub, id);
  }

  @Post('issues/:id/reopen')
  reopen(@Param('id', ParseUUIDPipe) id: string) {
    return this.circulation.reopen(this.sid(), id);
  }

  @Post('issues/:id/lost')
  markLost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.circulation.markLost(this.sid(), u.sub, id);
  }

  @Post('issues/:id/unlose')
  unlose(@Param('id', ParseUUIDPipe) id: string) {
    return this.circulation.unlose(this.sid(), id);
  }

  @Delete('issues/:id')
  voidIssue(@Param('id', ParseUUIDPipe) id: string) {
    return this.circulation.voidIssue(this.sid(), id);
  }

  // ── Fines ───────────────────────────────────────────────

  @Get('fines')
  listFines() {
    return this.fines.list(this.sid());
  }

  @Post('fines/:id/collect')
  collect(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.fines.collect(this.sid(), u.sub, id);
  }

  @Post('fines/:id/waive')
  waive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.fines.waive(this.sid(), u.sub, id);
  }

  @Post('fines/:id/reopen')
  reopenFine(@Param('id', ParseUUIDPipe) id: string) {
    return this.fines.reopenFine(this.sid(), id);
  }

  @Post('fines/remind')
  remind(@Body() dto: RemindFinesDto) {
    return this.fines.remind(this.sid(), dto);
  }

  // ── Hall ────────────────────────────────────────────────

  @Get('hall')
  hallToday(@Query('date') date?: string, @Query('classSectionId') classSectionId?: string) {
    return this.hall.today(this.sid(), { date, classSectionId });
  }

  @Post('hall/visits')
  saveVisit(@Body() dto: SaveHallVisitDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.hall.saveVisit(this.sid(), u.sub, dto);
  }
}

/** The reader's own shelf — students and teachers, never the librarian. */
@Controller('me/library')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('LIBRARY')
@Roles('STUDENT', 'TEACHER')
export class LibraryMeController {
  constructor(
    private readonly me: LibraryMeService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  mine(@CurrentUser() u: SchoolJwtPayload) {
    return this.me.forUser(this.tenant.requireTenant().schoolId, u.sub, u.role);
  }
}

/**
 * Daily due-soon nudge. Same shape as `NotificationOutboxController`:
 * `@Public()` (no user JWT exists for a Vercel Cron invocation) + the
 * constant-time `CronSecretGuard`, exposed on GET and POST because Vercel
 * Cron issues GET.
 */
@Controller('internal/cron/library-due-soon')
@Public()
@UseGuards(CronSecretGuard)
export class LibraryDueSoonController {
  constructor(private readonly dueSoon: LibraryDueSoonService) {}

  @Get()
  runGet() {
    return this.dueSoon.run();
  }

  @Post()
  runPost() {
    return this.dueSoon.run();
  }
}
