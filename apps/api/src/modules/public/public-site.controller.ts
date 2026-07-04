import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicSiteService } from './public-site.service';
import { Public } from '../../common/auth/public.decorator';

@Controller('public')
export class PublicSiteController {
  constructor(private readonly publicSite: PublicSiteService) {}

  /**
   * Unauthenticated, host-resolved public site data.
   * Generous throttle: 300 requests per 60 s per IP.
   */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('site')
  site() {
    return this.publicSite.getSite();
  }
}
