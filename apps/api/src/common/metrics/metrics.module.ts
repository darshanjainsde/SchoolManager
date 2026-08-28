import { Global, Module, OnModuleInit } from '@nestjs/common';
import { setTenantTxObserver } from '@skoolos/db';
import { MetricsService } from './metrics.service';
import { currentRouteLabel } from './route-context';

/**
 * Global so the interceptor and any service can reach one collector.
 *
 * On init it registers the tenant-transaction observer, which is how
 * connection-hold time gets attributed to the route that caused it — the label
 * comes from AsyncLocalStorage rather than being threaded through packages/db,
 * which must stay free of Nest.
 */
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule implements OnModuleInit {
  constructor(private readonly metrics: MetricsService) {}

  onModuleInit(): void {
    setTenantTxObserver((holdMs) => {
      const label = currentRouteLabel();
      if (label) this.metrics.recordDbHold(label, holdMs);
    });
  }
}
