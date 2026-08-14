import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenancyModule } from '../../tenancy';
import { PlansModule } from '../../plans';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/** Same shape as CirculationModule — see its doc for why JwtService is provided
 *  directly and why PlansModule must be imported for RequireFeatureGuard. */
@Module({
  imports: [TenancyModule, PlansModule],
  controllers: [MeController],
  providers: [JwtService, MeService],
})
export class MeModule {}
