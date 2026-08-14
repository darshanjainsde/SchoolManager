import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenancyModule } from '../../tenancy';
import { PlansModule } from '../../plans';
import { RegisterController } from './register.controller';
import { RegisterService } from './register.service';

/** Same shape as CatalogModule — see its doc for why JwtService is provided
 *  directly and why PlansModule must be imported for RequireFeatureGuard. */
@Module({
  imports: [TenancyModule, PlansModule],
  controllers: [RegisterController],
  providers: [JwtService, RegisterService],
})
export class RegisterModule {}
