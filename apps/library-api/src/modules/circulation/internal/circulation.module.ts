import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenancyModule } from '../../tenancy';
import { PlansModule } from '../../plans';
import { IdempotencyModule } from '../../../common/idempotency/idempotency.module';
import { CirculationController } from './circulation.controller';
import { LoansService } from './loans.service';

/**
 * Same shape as `CatalogModule` (see its own doc comment for the full
 * reasoning): guard classes passed to `@UseGuards(...)` on
 * `CirculationController` are auto-registered by Nest and not listed here,
 * but their OWN constructor dependencies must be resolvable from this
 * module's import graph —
 *   - RolesGuard: no app-specific deps.
 *   - RequireFeatureGuard: needs PlanResolverService -> `imports: [PlansModule]`.
 *   - LibJwtGuard: needs JwtService, not exported by AuthModule -> provided
 *     directly below (a second bare instance is safe; see CatalogModule).
 *   - IdempotencyInterceptor (used per-route via `@UseInterceptors`, not
 *     globally): needs `'IDEMPOTENCY_STORE'` and `OrgContextService` ->
 *     `imports: [IdempotencyModule]` (which itself imports TenancyModule).
 */
@Module({
  imports: [TenancyModule, PlansModule, IdempotencyModule],
  controllers: [CirculationController],
  providers: [JwtService, LoansService],
})
export class CirculationModule {}
