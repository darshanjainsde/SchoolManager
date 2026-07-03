import { Module } from '@nestjs/common';
import { TenancyModule } from '../../tenancy';
import { FeatureResolverService } from './feature-resolver.service';
import { RequireFeatureGuard } from './require-feature.guard';

@Module({
  imports: [TenancyModule],
  providers: [FeatureResolverService, RequireFeatureGuard],
  exports: [FeatureResolverService, RequireFeatureGuard],
})
export class FeaturesModule {}
