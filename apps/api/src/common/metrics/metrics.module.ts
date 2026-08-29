import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { setListOverflowObserver, setTenantTxObserver } from '@skoolos/db';
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
  private readonly logger = new Logger(MetricsModule.name);

  constructor(private readonly metrics: MetricsService) {}

  onModuleInit(): void {
    // A list that comes back exactly full was probably clipped. Ceilings are
    // set above what any query should legitimately return, so this firing means
    // either a tenant has outgrown one or a query is missing a filter — and a
    // quietly clipped list looks correct while being wrong, which is why it is
    // reported rather than swallowed.
    setListOverflowObserver(({ model, take }) => {
      this.logger.warn(
        `list ceiling reached on ${model} (take=${take}) — the response was probably truncated`,
      );
      const label = currentRouteLabel();
      if (label) this.metrics.recordError(label, 'list ceiling reached');
    });

    setTenantTxObserver((holdMs) => {
      const label = currentRouteLabel();
      if (label) this.metrics.recordDbHold(label, holdMs);
    });
  }
}
