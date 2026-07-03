import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { TeachersService } from './teachers.service';
import { TeachersController } from './teachers.controller';

@Module({
  imports: [FeaturesModule, TenancyModule],
  providers: [CatalogService, TeachersService],
  controllers: [CatalogController, TeachersController],
  exports: [CatalogService, TeachersService],
})
export class ManagementModule {}
