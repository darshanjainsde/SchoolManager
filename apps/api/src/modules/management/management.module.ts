import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { TeachersService } from './teachers.service';
import { TeachersController } from './teachers.controller';
import { ClassesService } from './classes.service';
import { ClassesController } from './classes.controller';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { TimetableService } from './timetable.service';
import { TimetableController } from './timetable.controller';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';

@Module({
  imports: [AuthModule, FeaturesModule, TenancyModule],
  providers: [CatalogService, TeachersService, ClassesService, StudentsService, TimetableService, AnnouncementsService],
  controllers: [
    CatalogController,
    TeachersController,
    ClassesController,
    StudentsController,
    TimetableController,
    AnnouncementsController,
  ],
  exports: [CatalogService, TeachersService, ClassesService, StudentsService, TimetableService, AnnouncementsService],
})
export class ManagementModule {}
