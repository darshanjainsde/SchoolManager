import { Module } from '@nestjs/common';
import { TenancyModule } from '../../tenancy';
import { FeaturesModule } from '../../features';
import { OwnerHostGuard } from '../../../common/auth/owner-host.guard';
import { BlogMarketingService } from './blog-marketing.service';
import { BlogMarketingController } from './blog-marketing.controller';
import { BlogPublicService } from './blog-public.service';
import { BlogPublicController } from './blog-public.controller';
import { BlogCmsService } from './blog-cms.service';
import { BlogCmsController } from './blog-cms.controller';
import { BlogOwnerService } from './blog-owner.service';
import { BlogOwnerController } from './blog-owner.controller';

@Module({
  imports: [TenancyModule, FeaturesModule],
  controllers: [BlogMarketingController, BlogPublicController, BlogCmsController, BlogOwnerController],
  providers: [BlogMarketingService, BlogPublicService, BlogCmsService, BlogOwnerService, OwnerHostGuard],
})
export class BlogModule {}
