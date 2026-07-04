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

@Module({
  imports: [AuthModule, FeaturesModule, TenancyModule],
  providers: [CatalogService, TeachersService, ClassesService, StudentsService, TimetableService],
  controllers: [
    CatalogController,
    TeachersController,
    ClassesController,
    StudentsController,
    TimetableController,
  ],
  exports: [CatalogService, TeachersService, ClassesService, StudentsService, TimetableService],
})
export class ManagementModule {}
