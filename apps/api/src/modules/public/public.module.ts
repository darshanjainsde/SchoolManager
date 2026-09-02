import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { CommunityModule } from '../community';
import { PublicSiteService } from './public-site.service';
import { PublicSiteController } from './public-site.controller';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';
import { EnquiryAdminController } from './enquiry-admin.controller';
import { TvService } from './tv.service';
import { TvAdminController, TvController } from './tv.controller';

@Module({
  imports: [FeaturesModule, CommunityModule],
  controllers: [PublicSiteController, EnquiryController, EnquiryAdminController, TvController, TvAdminController],
  providers: [PublicSiteService, EnquiryService, TvService],
})
export class PublicModule {}
