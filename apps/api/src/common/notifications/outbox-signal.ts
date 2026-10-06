import { Logger } from '@nestjs/common';
import { runInBackground } from './run-in-background';

/**
 * ASK FOR A DRAIN, FROM ANYWHERE.
 *
 * The outbox is durable; the nightly cron is its safety net, not its delivery
 * path. Until 2026-10-06 only 2 of 19 writers asked for a drain, so a leave
 * request with Approve/Reject buttons could wait until 02:00 UTC. Every
 * writer now calls this AFTER its transaction resolves.
 *
 * Module-level on purpose: a writer needs no injection to ask, so adding a
 * writer never touches a module's providers. `NotificationOutboxService`
 * registers the drainer when Nest boots; in a script or a unit test nothing
 * is registered and this is a no-op.
 *
 * The delay does two jobs: it coalesces a burst (a class of 40 marked absent
 * is one drain, not 40), and it gives a caller that asked from inside a
 * transaction time to commit before the drain looks for the row.
 */
export const OUTBOX_DRAIN_DELAY_MS = 750;

type Drainer = () => Promise<unknown>;
const logger = new Logger('OutboxSignal');
let drainer: Drainer | null = null;
let scheduled = false;

export function registerOutboxDrainer(fn: Drainer | null): void {
  drainer = fn;
}

export function requestOutboxDrain(): void {
  if (!drainer || scheduled) return;
  scheduled = true;
  const fn = drainer;
  runInBackground(
    () =>
      new Promise<void>((resolve) => setTimeout(resolve, OUTBOX_DRAIN_DELAY_MS)).then(() => {
        // Cleared BEFORE the drain runs: a row written while this drain is
        // working must be able to schedule the next one.
        scheduled = false;
        return fn();
      }),
    (e) => {
      scheduled = false;
      logger.warn(`requested outbox drain failed: ${(e as Error)?.message}`);
    },
  );
}

/** Test seam. */
export function resetOutboxSignal(): void {
  drainer = null;
  scheduled = false;
}
