import { Module } from '@nestjs/common';
import { TenancyModule } from '../../tenancy';
import { StorageModule } from '../../../common/storage/storage.module';
import { SiteContentService } from './site-content.service';
import { SiteContentController } from './site-content.controller';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { AdmissionsService } from './admissions.service';
import { AdmissionsController } from './admissions.controller';
import { HallOfFameService } from './hall-of-fame.service';
import { HallOfFameController } from './hall-of-fame.controller';
import { DesignDraftsService } from './design-drafts.service';
import { DesignDraftsController } from './design-drafts.controller';
import { SitePurgeInterceptor } from './site-purge.interceptor';
import { SchoolPagesService } from './school-pages.service';
import { SchoolPagesController } from './school-pages.controller';

@Module({
  imports: [TenancyModule, StorageModule],
  providers: [
    SiteContentService,
    MediaService,
    StaffService,
    CoursesService,
    AdmissionsService,
    HallOfFameService,
    DesignDraftsService,
    SchoolPagesService,
    SitePurgeInterceptor,
  ],
  controllers: [
    SiteContentController,
    MediaController,
    StaffController,
    CoursesController,
    AdmissionsController,
    HallOfFameController,
    DesignDraftsController,
    SchoolPagesController,
  ],
  exports: [SiteContentService, MediaService, StaffService, CoursesService, AdmissionsService, HallOfFameService],
})
export class CmsModule {}
