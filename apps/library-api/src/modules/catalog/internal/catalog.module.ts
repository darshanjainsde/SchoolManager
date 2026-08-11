import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenancyModule } from '../../tenancy';
import { PlansModule } from '../../plans';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { CopiesService } from './copies.service';
import { SearchService } from './search.service';
import { TitlesService } from './titles.service';

/**
 * Guard classes referenced by `@UseGuards(...)` on CatalogController
 * (LibJwtGuard, RequireFeatureGuard, RolesGuard, BranchScopeGuard) are
 * deliberately NOT listed in `providers` below — Nest auto-registers a
 * class passed to `@UseGuards` as an injectable of the module that declares
 * the controller (confirmed by reading `@nestjs/core`'s
 * `DependenciesScanner.reflectDynamicMetadata`/`insertInjectable`, since
 * this repo has no controller using these guards yet to copy from). What
 * DOES need to be resolvable here is each guard's OWN constructor
 * dependency:
 *   - RolesGuard, BranchScopeGuard: no app-specific deps (Reflector is
 *     bound by Nest's always-global InternalCoreModule).
 *   - RequireFeatureGuard: needs PlanResolverService -> `imports: [PlansModule]`.
 *   - LibJwtGuard: needs JwtService -> provided directly below, because
 *     AuthModule does not export it (AuthModule only exports
 *     PasswordService). A second bare `JwtService` instance is safe here:
 *     it takes no constructor options, and both AuthController's calls and
 *     LibJwtGuard's own calls always pass secret/audience/expiresIn
 *     explicitly per call — see auth.module.ts's own `providers: [...,
 *     JwtService, ...]` for the identical shape.
 */
@Module({
  imports: [TenancyModule, PlansModule],
  controllers: [CatalogController],
  providers: [JwtService, TitlesService, CopiesService, CategoriesService, SearchService],
})
export class CatalogModule {}
