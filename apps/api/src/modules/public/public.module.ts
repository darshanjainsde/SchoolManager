import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { CommunityModule } from '../community';
import { PublicSiteService } from './public-site.service';
import { PublicSiteController } from './public-site.controller';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';
import { EnquiryAdminController } from './enquiry-admin.controller';

@Module({
  imports: [FeaturesModule, CommunityModule],
  controllers: [PublicSiteController, EnquiryController, EnquiryAdminController],
  providers: [PublicSiteService, EnquiryService],
})
export class PublicModule {}
