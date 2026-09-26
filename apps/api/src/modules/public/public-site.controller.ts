import { Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PublicSiteService } from './public-site.service';
import { PublicBirthdaysService } from './public-birthdays.service';
import { PublicRecordsService } from './public-records.service';
import { Public } from '../../common/auth/public.decorator';
import { TenantContextService } from '../tenancy';

@Controller('public')
export class PublicSiteController {
  constructor(
    private readonly publicSite: PublicSiteService,
    private readonly birthdaysSvc: PublicBirthdaysService,
    private readonly recordsSvc: PublicRecordsService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Unauthenticated, host-resolved public site data.
   * Generous throttle: 300 requests per 60 s per IP.
   *
   * CACHED, like its two siblings below. This is the one response in the whole
   * API that is byte-identical for every visitor to a school: no session, no
   * pupil, nothing per-person in it. It was nonetheless answering `no-store`,
   * because the blanket header in `configure-app.ts` is the right default for
   * an API where everything else IS per-person — so this endpoint had to opt
   * out, and never had.
   *
   * A minute in any shared cache, then stale for ten while it refreshes: a
   * school that edits its website sees the change within the minute, and no
   * visitor ever waits on the origin to find out the page has not changed.
   * The server-rendered school site is already covered by Next's own data
   * cache; this is what the browser and the edge get, which is what the
   * birthday wall and the website preview fetch directly.
   */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('site')
  async site(@Res({ passthrough: true }) res: Response) {
    const r = await this.publicSite.getSite();
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=600');
    return r;
  }

  /**
   * The Book of Records for the public host (Sports wing). 404 unless the
   * school switched it on with consent. A minute in any shared cache, then
   * stale for an hour while refreshing: a record verified at the desk is on
   * the site within the minute, and the site never waits on the desk.
   */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('records')
  async records(@Res({ passthrough: true }) res: Response) {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Not found');
    const r = await this.recordsSvc.forPublic(ctx.schoolId);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=3600');
    return r;
  }

  /**
   * The birthday wall for the public host (Active Roster, Track B). 404 unless
   * the school switched Birthdays on AND opened it to the public. Day and month
   * only — never a year. Cached until the school's own midnight.
   */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('birthdays')
  async birthdays(@Query('window') window: string | undefined, @Res({ passthrough: true }) res: Response) {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Not found');
    const r = await this.birthdaysSvc.forAudience(ctx.schoolId, 'PUBLIC', window);
    // A minute in any shared cache, then serve stale while refreshing until the
    // school's midnight: a child the office just hid is gone within the minute
    // the console promises, and the wall still never re-renders for every visit.
    res.setHeader('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${r.maxAge}`);
    return r;
  }
}
