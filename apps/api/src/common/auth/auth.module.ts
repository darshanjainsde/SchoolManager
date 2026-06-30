import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { loadEnv } from '@skoolos/config';
import { SchoolJwtGuard } from './school-jwt.guard';
import { PlatformJwtGuard } from './platform-jwt.guard';
import { RolesGuard } from './roles.guard';

const env = loadEnv();

@Global()
@Module({
  imports: [
    JwtModule.register({
      // Per-audience secrets are passed at sign/verify time; this default is
      // never actually used because we always specify `secret` explicitly.
      secret: env.JWT_SCHOOL_ACCESS_SECRET,
    }),
  ],
  providers: [Reflector, SchoolJwtGuard, PlatformJwtGuard, RolesGuard],
  exports: [JwtModule, SchoolJwtGuard, PlatformJwtGuard, RolesGuard],
})
export class CommonAuthModule {}
