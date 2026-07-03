import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { SiteContentService } from './site-content.service';
import { UpdateProfileDto, UpdateHomepageDto, SetStatsDto, SetSocialDto } from './cms.dto';

@Controller('site')
@UseGuards(SchoolJwtGuard)
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

  @Put('stats')
  stats(@Body() dto: SetStatsDto) {
    return this.content.setStats(this.sid(), dto.items);
  }

  @Put('social')
  social(@Body() dto: SetSocialDto) {
    return this.content.setSocial(this.sid(), dto.links);
  }
}
