import { Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PublicSiteService } from './public-site.service';
import { PublicBirthdaysService } from './public-birthdays.service';
import { PublicRecordsService } from './public-records.service';
import { Public } from '../../common/auth/public.decorator';
import { TenantContextService } from '../tenancy';

/** See `site()` below: tenant-keyed, so never `public`, never `s-maxage`. */
const TENANT_PUBLIC_CACHE = 'private, no-cache';

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
   * PRIVATE, NEVER SHARED. Every `/public/*` route answers for the school in
   * `X-Skoolos-Host`; the URL is identical for every school. A `public` /
   * `s-maxage` header here let Vercel's edge store the body under that URL —
   * the edge keys on URL + `Vary: Origin` only, never on a custom header —
   * and on 2026-09-27 a request for a host that does not exist came back a
   * CDN HIT carrying Raffles' whole website. Every school on that edge wore
   * whichever site was fetched first, for up to eleven minutes ("my saved
   * theme never shows, the site is stuck on Holi" — another school's Holi).
   *
   * The database is spared by the Next server's own data cache, which is
   * keyed per host, tagged `site:<host>` and purged on save. The browser
   * (the editor's preview, the birthday wall) gets `no-cache`: ask every
   * time, take Express's 304 when nothing changed.
   * Guarded by public-cache-headers.spec.ts.
   */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('site')
  async site(@Res({ passthrough: true }) res: Response) {
    const r = await this.publicSite.getSite();
    res.setHeader('Cache-Control', TENANT_PUBLIC_CACHE);
    return r;
  }

  /**
   * The Book of Records for the public host (Sports wing). 404 unless the
   * school switched it on with consent. Private like `site()`: the school is a
   * request header, so a shared cache would hand one school's records to
   * the next school's visitors.
   */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('records')
  async records(@Res({ passthrough: true }) res: Response) {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Not found');
    const r = await this.recordsSvc.forPublic(ctx.schoolId);
    res.setHeader('Cache-Control', TENANT_PUBLIC_CACHE);
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
    // Private like `site()`; `r.maxAge` (the school's midnight) still bounds
    // the wall's own freshness on the client.
    res.setHeader('Cache-Control', TENANT_PUBLIC_CACHE);
    return r;
  }
}
