import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { TvService } from './tv.service';

/**
 * The screen itself. Public + host-resolved like `/public/site`, but the key
 * is the whole gate: without the school's own display token every failure —
 * no TV, wrong key, unknown school — answers an identical 404.
 */
@Controller('public')
export class TvController {
  constructor(private readonly tv: TvService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('tv')
  screen(@Query('key') key?: string) {
    return this.tv.screen(key);
  }
}

/** The office's switch: see the URL, rotate the key, turn it off. */
@Controller('manage/tv')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class TvAdminController {
  constructor(
    private readonly tv: TvService,
    private readonly tenant: TenantContextService,
  ) {}

  private ctx(): { schoolId: string; host: string | null } {
    const t = this.tenant.requireTenant();
    return { schoolId: t.schoolId, host: t.hostname ?? null };
  }

  @Get()
  status() {
    const { schoolId, host } = this.ctx();
    return this.tv.status(schoolId, host);
  }

  /** Enable, or rotate — one gesture: "give me a fresh URL". */
  @Get('rotate')
  rotate() {
    const { schoolId, host } = this.ctx();
    return this.tv.rotate(schoolId, host);
  }

  @Get('disable')
  disable() {
    const { schoolId } = this.ctx();
    return this.tv.disable(schoolId);
  }
}
