import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/auth/public.decorator';
import { BlogMarketingService } from './blog-marketing.service';

/** Public, unauthenticated endpoints backing the sckools.com global blog. */
@Controller('marketing/blog')
export class BlogMarketingController {
  constructor(private readonly marketing: BlogMarketingService) {}

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get()
  list() {
    return this.marketing.listGlobal();
  }

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':globalSlug')
  get(@Param('globalSlug') globalSlug: string) {
    return this.marketing.getGlobal(globalSlug);
  }
}
