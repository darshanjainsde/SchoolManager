import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { OrgContextService } from './org-context.service';
import { orgMiddleware } from './org.middleware';

@Module({ providers: [OrgContextService], exports: [OrgContextService] })
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(orgMiddleware).forRoutes('*');
  }
}
