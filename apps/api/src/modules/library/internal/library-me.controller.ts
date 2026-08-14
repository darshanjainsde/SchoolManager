import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { LibraryOrgService } from './library-org.service';
import { LibraryMeService } from './library-me.service';

/**
 * The library, inside the portal a student or teacher already signs into.
 *
 * Mounted on SCKOOLS' guards — `SchoolJwtGuard`, `RequireFeatureGuard`,
 * `RolesGuard` — exactly like every other module here. There is no
 * `LibJwtGuard`, no `X-Library-Host` and no token exchange: the caller already
 * has a Sckools session, and the whole point of folding the library in is that
 * a second identity system stops existing.
 *
 * `SchoolJwtGuard` already asserts `payload.schoolId === req.tenant.schoolId`,
 * which is the cross-tenant replay defence the library's own org middleware
 * said it relied on downstream. The guarantee survives, carried by the sibling
 * mechanism that was already there.
 */
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('LIBRARY')
@Controller('me/library')
export class LibraryMeController {
  constructor(
    private readonly orgs: LibraryOrgService,
    private readonly me: LibraryMeService,
  ) {}

  /**
   * Resolves this caller's school to its library.
   *
   * A school with `LIBRARY` enabled but nothing provisioned throws
   * FEATURE_DISABLED rather than 401 or 500. That distinction is the whole
   * point: before this, an unprovisioned school made the librarian see "not
   * authorised" for a library that simply did not exist, which sends a school
   * to support instead of to the provisioning button.
   */
  private async orgId(user: SchoolJwtPayload): Promise<string> {
    const orgId = await this.orgs.orgIdForSchool(user.schoolId);
    if (!orgId) throw new ForbiddenException('This school does not have a library yet');
    return orgId;
  }

  /**
   * My books, and what I owe if I owe anything.
   *
   * STUDENT and TEACHER share this route and this shape deliberately. The
   * borrowing RULES differ — 14 days / 2 books against 30 / 5, driven by
   * `CirculationPolicy` per member type — but the experience is identical, and
   * two endpoints would drift.
   */
  @Get()
  @Roles('STUDENT', 'TEACHER')
  async mine(@CurrentUser() user: SchoolJwtPayload) {
    return this.me.mine(await this.orgId(user), user.sub);
  }

  /** Is it on the shelf? Availability is counted from copy status, never stored. */
  @Get('shelf')
  @Roles('STUDENT', 'TEACHER')
  async shelf(@CurrentUser() user: SchoolJwtPayload, @Query('q') q?: string) {
    return this.me.shelf(await this.orgId(user), q ?? '');
  }

  /**
   * Which of my class has not brought a book back. TEACHER only.
   *
   * Names and titles, never amounts. A staffroom is a public place, and the
   * moment this shows what children owe it becomes fee collection and stops
   * being opened.
   */
  @Get('class/:classRef')
  @Roles('TEACHER')
  async classNotReturned(
    @CurrentUser() user: SchoolJwtPayload,
    @Query('classRef') classRef: string,
  ) {
    if (!classRef?.trim()) return [];
    return this.me.classNotReturned(await this.orgId(user), classRef.trim());
  }
}
