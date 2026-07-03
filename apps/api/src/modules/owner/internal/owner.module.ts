import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../../auth';
import { FeaturesModule } from '../../features';
import { OwnerAuthService } from './owner-auth.service';
import { OwnerAuthController } from './owner-auth.controller';
import { OwnerHostGuard } from './owner-host.guard';
import { OwnerSchoolsService } from './owner-schools.service';
import { OwnerController } from './owner.controller';

@Module({
  imports: [JwtModule.register({}), AuthModule, FeaturesModule],
  controllers: [OwnerAuthController, OwnerController],
  providers: [OwnerAuthService, OwnerHostGuard, OwnerSchoolsService],
})
export class OwnerModule {}
