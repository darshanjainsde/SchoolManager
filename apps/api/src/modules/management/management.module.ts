import { Module } from '@nestjs/common';
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

@Module({
  imports: [FeaturesModule, TenancyModule],
  providers: [CatalogService, TeachersService, ClassesService, StudentsService],
  controllers: [CatalogController, TeachersController, ClassesController, StudentsController],
  exports: [CatalogService, TeachersService, ClassesService, StudentsService],
})
export class ManagementModule {}
