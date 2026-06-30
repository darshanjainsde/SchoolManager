import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { SchoolLookupService } from './school-lookup.service';
import { tenantMiddleware } from './tenant.middleware';
import { UsersController } from './users.controller';

@Global()
@Module({
  providers: [TenantContextService, SchoolLookupService],
  controllers: [UsersController],
  exports: [TenantContextService, SchoolLookupService],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Functional middleware — independent of NestJS DI quirks under tsx.
    consumer.apply(tenantMiddleware).forRoutes('*');
  }
}
