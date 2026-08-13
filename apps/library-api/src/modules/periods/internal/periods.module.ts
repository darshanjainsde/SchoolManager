import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenancyModule } from '../../tenancy';
import { PlansModule } from '../../plans';
import { PeriodsController } from './periods.controller';
import { PeriodsService } from './periods.service';

/** Same shape as the other feature modules — see CatalogModule's doc. */
@Module({
  imports: [TenancyModule, PlansModule],
  controllers: [PeriodsController],
  providers: [JwtService, PeriodsService],
})
export class PeriodsModule {}
