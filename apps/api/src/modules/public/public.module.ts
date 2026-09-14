import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { CommunityModule } from '../community';
import { TenancyModule } from '../tenancy';
import { SportsModule } from '../sports';
import { PublicSiteService } from './public-site.service';
import { PublicSiteController } from './public-site.controller';
import { PublicBirthdaysService } from './public-birthdays.service';
import { PublicRecordsService } from './public-records.service';
import { EnquiryService } from './enquiry.service';
import { EnquiryController } from './enquiry.controller';
import { EnquiryAdminController } from './enquiry-admin.controller';
import { TvService } from './tv.service';
import { TvAdminController, TvController } from './tv.controller';

@Module({
  imports: [FeaturesModule, CommunityModule, TenancyModule, SportsModule],
  controllers: [PublicSiteController, EnquiryController, EnquiryAdminController, TvController, TvAdminController],
  providers: [PublicSiteService, PublicBirthdaysService, PublicRecordsService, EnquiryService, TvService],
  exports: [PublicBirthdaysService],
})
export class PublicModule {}
