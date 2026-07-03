import { Module } from '@nestjs/common';
import { TenancyModule } from '../../tenancy';
import { StorageModule } from '../../../common/storage/storage.module';
import { SiteContentService } from './site-content.service';
import { SiteContentController } from './site-content.controller';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';

@Module({
  imports: [TenancyModule, StorageModule],
  providers: [SiteContentService, MediaService],
  controllers: [SiteContentController, MediaController],
  exports: [SiteContentService, MediaService],
})
export class CmsModule {}
