import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../../auth';
import { FeaturesModule } from '../../features';
import { OwnerAuthService } from './owner-auth.service';
import { OwnerAuthController } from './owner-auth.controller';
import { OwnerHostGuard } from './owner-host.guard';

@Module({
  imports: [JwtModule.register({}), AuthModule, FeaturesModule],
  controllers: [OwnerAuthController],
  providers: [OwnerAuthService, OwnerHostGuard],
})
export class OwnerModule {}
