import { SitePurgeInterceptor } from './site-purge.interceptor';
import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { HallOfFameService } from './hall-of-fame.service';
import { HallOfFameSettingsDto, SetHallOfFameGroupsDto, SetHallOfFamePodiumDto } from './cms.dto';

@Controller('site/hall-of-fame')
// Any write here drops this school's cached pages — see the interceptor.
@UseInterceptors(SitePurgeInterceptor)
// SchoolJwtGuard establishes WHICH school you belong to; it reads no role at
// all. RolesGuard beside it is what keeps a STUDENT token out of the editor.
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
export class HallOfFameController {
  constructor(
    private readonly hof: HallOfFameService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  /** Groups, every batch's entries, the years that have entries, settings. */
  @Get()
  overview() {
    return this.hof.overview(this.sid());
  }

  /** Replace the ordered set of groups (what podiums are for). */
  @Put('groups')
  setGroups(@Body() dto: SetHallOfFameGroupsDto) {
    return this.hof.setGroups(this.sid(), dto.groups);
  }

  /** Replace one group's podium for one batch year. */
  @Put('groups/:groupId/:year')
  setPodium(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: SetHallOfFamePodiumDto,
  ) {
    return this.hof.setPodium(this.sid(), groupId, year, dto.entries);
  }

  @Put('settings')
  setSettings(@Body() dto: HallOfFameSettingsDto) {
    return this.hof.setSettings(this.sid(), dto);
  }
}
