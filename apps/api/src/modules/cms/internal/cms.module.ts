import { Module } from '@nestjs/common';
import { TenancyModule } from '../../tenancy';
import { SiteContentService } from './site-content.service';
import { SiteContentController } from './site-content.controller';

@Module({
  imports: [TenancyModule],
  providers: [SiteContentService],
  controllers: [SiteContentController],
  exports: [SiteContentService],
})
export class CmsModule {}
