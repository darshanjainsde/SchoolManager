import { SitePurgeInterceptor } from './site-purge.interceptor';
import { Body, Controller, Get, Put, UseGuards , UseInterceptors } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { SiteContentService } from './site-content.service';
import { UpdateProfileDto, UpdateHomepageDto, SetStatsDto, SetSocialDto, UpdateCelebrationsDto } from './cms.dto';

@Controller('site')
// Any write here drops this school's cached pages — see the interceptor.
@UseInterceptors(SitePurgeInterceptor)
// SchoolJwtGuard establishes WHICH school you belong to; it reads no role at
// all. Without RolesGuard beside it every route here was reachable with a
// STUDENT or PARENT token — and the enquiries ones hand back other families'
// names and phone numbers. Every caller lives under /app, which is already
// SCHOOL_ADMIN-only, so this locks out nobody who was legitimately using it.
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
export class SiteContentController {
  constructor(
    private readonly content: SiteContentService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get('content')
  get() {
    return this.content.getContent(this.sid());
  }

  @Put('profile')
  profile(@Body() dto: UpdateProfileDto) {
    return this.content.updateProfile(this.sid(), dto);
  }

  @Put('homepage')
  homepage(@Body() dto: UpdateHomepageDto) {
    return this.content.updateHomepage(this.sid(), dto);
  }

  // ── Birthdays & celebrations (Track B) ──
  @Get('celebrations')
  getCelebrations() {
    return this.content.getCelebrations(this.sid());
  }

  @Put('celebrations')
  updateCelebrations(@Body() dto: UpdateCelebrationsDto) {
    return this.content.updateCelebrations(this.sid(), dto);
  }

  @Get('celebrations/preview')
  celebrationsPreview() {
    return this.content.celebrationsPreview(this.sid());
  }

  @Put('stats')
  stats(@Body() dto: SetStatsDto) {
    return this.content.setStats(this.sid(), dto.items);
  }

  @Put('social')
  social(@Body() dto: SetSocialDto) {
    return this.content.setSocial(this.sid(), dto.links);
  }
}
