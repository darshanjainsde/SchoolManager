import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@skoolos/db';

export const REQUIRE_FEATURE = 'require_feature';
export const RequireFeature = (key: FeatureKey) => SetMetadata(REQUIRE_FEATURE, key);
