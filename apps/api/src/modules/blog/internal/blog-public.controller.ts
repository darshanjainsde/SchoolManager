import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/auth/public.decorator';
import { BlogPublicService } from './blog-public.service';

/** Public, unauthenticated, host-resolved tenant blog reads. */
@Controller('public/blog')
export class BlogPublicController {
  constructor(private readonly blog: BlogPublicService) {}

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get()
  list() {
    return this.blog.list();
  }

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.blog.getBySlug(slug);
  }
}
