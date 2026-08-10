import { SetMetadata } from '@nestjs/common';
import type { CapabilityKey } from './resolve';

export const REQUIRE_FEATURE_KEY = 'library:requireFeature';

/**
 * Marks a handler/controller as gated behind one or more plan capabilities.
 * Read by RequireFeatureGuard via Reflector. Absence of this decorator means
 * "no capability required" — RequireFeatureGuard allows the request through
 * without ever resolving a plan for it.
 */
export const RequireFeature = (...keys: CapabilityKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_FEATURE_KEY, keys);
