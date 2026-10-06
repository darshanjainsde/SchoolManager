import { Logger } from '@nestjs/common';
import { runInBackground } from './run-in-background';
import { invocationStartedAt } from './invocation-clock';

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

/** The function's hard ceiling (`maxDuration: 60` in apps/api/vercel.json). */
export const INVOCATION_CEILING_MS = 60_000;

/**
 * No send STARTS with less than this left of the 60 s ceiling. A send killed
 * mid-flight repeats after the claim TTL; not starting it is the safer side.
 */
export const ROW_START_RESERVE_MS = 15_000;

type Drainer = (opts: { deadline?: number }) => Promise<unknown>;
const logger = new Logger('OutboxSignal');
let drainer: Drainer | null = null;

/** The drain a burst is waiting for: whose deadline it carries, and when it fires. */
interface Pending {
  deadline: number | undefined;
  fireAt: number;
}
let pending: Pending | null = null;

/** Does deadline `a` leave more time than `b`? No deadline (a script) is the most time of all. */
function leavesMoreTime(a: number | undefined, b: number | undefined): boolean {
  return b !== undefined && (a === undefined || a > b);
}

export function registerOutboxDrainer(fn: Drainer | null): void {
  drainer = fn;
}

export function requestOutboxDrain(): void {
  if (!drainer) return;
  // The drain runs inside THIS caller's invocation, so it inherits this
  // caller's deadline — measured from when the invocation began.
  const started = invocationStartedAt();
  const deadline = started === undefined ? undefined : started + INVOCATION_CEILING_MS - ROW_START_RESERVE_MS;
  // A burst is one drain, and it keeps the LATEST deadline of the burst. Kept
  // the first, a request already ~45 s into its invocation handed the drain
  // almost no time, and every fresh request after it within the delay was
  // folded into that dead drain. A later request with more time re-schedules
  // the drain inside ITS invocation (the earlier timer stands down), at the
  // SAME fire time — so a stream of requests can never push the drain back.
  if (pending && !leavesMoreTime(deadline, pending.deadline)) return;
  const mine: Pending = { deadline, fireAt: pending?.fireAt ?? Date.now() + OUTBOX_DRAIN_DELAY_MS };
  pending = mine;
  const fn = drainer;
  runInBackground(
    () =>
      new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, mine.fireAt - Date.now()))).then(() => {
        // Superseded: a later request's invocation runs this burst's drain.
        if (pending !== mine) return undefined;
        // Cleared BEFORE the drain runs: a row written while this drain is
        // working must be able to schedule the next one.
        pending = null;
        return fn({ deadline });
      }),
    (e) => {
      if (pending === mine) pending = null;
      logger.warn(`requested outbox drain failed: ${(e as Error)?.message}`);
    },
  );
}

/** Test seam. */
export function resetOutboxSignal(): void {
  drainer = null;
  pending = null;
}
