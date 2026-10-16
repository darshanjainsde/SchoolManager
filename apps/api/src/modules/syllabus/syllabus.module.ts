import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { SyllabusController } from './syllabus.controller';
import { SyllabusPortalController } from './syllabus-portal.controller';
import { SyllabusPortalService } from './syllabus-portal.service';
import { SyllabusService } from './syllabus.service';

/**
 * The syllabus tracker: chapters per grade + subject, progress per section,
 * a private note per child. Behind the COURSE_MANAGEMENT feature.
 */
@Module({
  imports: [FeaturesModule, TenancyModule],
  controllers: [SyllabusController, SyllabusPortalController],
  providers: [SyllabusService, SyllabusPortalService],
})
export class SyllabusModule {}
