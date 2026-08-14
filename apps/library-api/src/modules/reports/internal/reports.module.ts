import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenancyModule } from '../../tenancy';
import { PlansModule } from '../../plans';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Same shape as the other feature modules — see CatalogModule's doc. */
@Module({
  imports: [TenancyModule, PlansModule],
  controllers: [ReportsController],
  providers: [JwtService, ReportsService],
})
export class ReportsModule {}
