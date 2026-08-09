import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { TenancyModule } from './modules/tenancy';

@Module({ imports: [TenancyModule, HealthModule] })
export class AppModule {}
