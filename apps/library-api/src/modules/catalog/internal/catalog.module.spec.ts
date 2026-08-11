import { Test } from '@nestjs/testing';
import { CatalogModule } from './catalog.module';
import { CatalogController } from './catalog.controller';

/**
 * Regression test for a non-obvious DI trap: `@UseGuards(LibJwtGuard,
 * RequireFeatureGuard, RolesGuard, BranchScopeGuard)` on CatalogController
 * does NOT require those guard classes to be listed in CatalogModule's own
 * `providers` — Nest auto-registers a class passed to `@UseGuards` as an
 * injectable of the module that declares the controller (verified by
 * reading `@nestjs/core`'s `DependenciesScanner`/`GuardsContextCreator`
 * source, since no controller elsewhere in this repo used these guards yet
 * to copy a working pattern from). What DOES have to be independently
 * resolvable is each guard's OWN constructor dependency — RequireFeatureGuard
 * needs `PlanResolverService` (from `imports: [PlansModule]`), LibJwtGuard
 * needs `JwtService` (provided directly in this module, since AuthModule
 * does not export it). If either import is ever removed, `.compile()`
 * below fails loudly at boot with an UnknownDependenciesException — this
 * test is what would catch that, in isolation from AppModule's much larger
 * graph.
 */
describe('CatalogModule wiring', () => {
  it('compiles standalone and resolves CatalogController with all its guard dependencies', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CatalogModule] }).compile();
    try {
      expect(moduleRef.get(CatalogController)).toBeInstanceOf(CatalogController);
    } finally {
      await moduleRef.close();
    }
  });
});
