import { Controller, ForbiddenException, Get, Headers } from '@nestjs/common';
import { getLibraryPlatformPrisma } from '@library/db';
import { loadLibraryEnv } from '../config/env';

/**
 * The nightly outbox sweep.
 *
 * This route existed in `vercel.json`'s `crons` before it existed in code, so
 * Vercel called `/internal/cron/notification-outbox` every night at 02:00 and
 * got a 404 — declared infrastructure that was never built. Meanwhile
 * `issues.service.ts` writes a durable `NotificationOutbox` row on every
 * reservation promotion, so the table has been growing since Phase 1 with
 * nothing ever reading it.
 *
 * WHAT THIS DOES NOT DO: send anything. Which channel a school may use, and
 * what a message is allowed to say, are open product decisions — P3
 * deliberately sends no money notification at all, and that silence is what
 * makes "no push saying you owe ₹300" true by construction. Inventing a sender
 * here would quietly break that.
 *
 * So it does the one useful thing that needs no decision: it BOUNDS the table.
 * A GC sweep of expired data is explicitly sanctioned by the no-scheduler rule
 * (trap 7) precisely because it is cleanup, not a state transition — a missed
 * run delays a deletion, it cannot corrupt an Issue, a Reservation or a Fine,
 * because none of their state depends on this table ever being read.
 *
 * It runs as the PLATFORM client, across every org, because a cron has no
 * tenant: there is no host header and no logged-in user to scope it by. That
 * is the same reason the seed and the host lookup use it.
 */
const RETENTION_DAYS = 90;

@Controller('internal/cron')
export class OutboxCronController {
  @Get('notification-outbox')
  async sweep(@Headers('authorization') auth?: string) {
    // Vercel sends `Authorization: Bearer <CRON_SECRET>` when the project has
    // one. The route is otherwise publicly reachable, so when a secret IS
    // configured it is required — fail closed. When none is configured (local,
    // and any deploy that has not set it) the route stays open, which is the
    // honest state rather than a false sense of protection.
    const secret = loadLibraryEnv().CRON_SECRET;
    if (secret && auth !== `Bearer ${secret}`) {
      throw new ForbiddenException('This endpoint is for the scheduler');
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const prisma = getLibraryPlatformPrisma();

    // Only rows that were actually dispatched are collected. An UNDISPATCHED
    // row is a message somebody is still owed; deleting it because it got old
    // would destroy the record of something the school never told a parent.
    const { count } = await prisma.notificationOutbox.deleteMany({
      where: { sentAt: { not: null, lt: cutoff } },
    });

    const [pending] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM "NotificationOutbox" WHERE "sentAt" IS NULL
    `;

    return {
      swept: count,
      retentionDays: RETENTION_DAYS,
      // Surfaced deliberately: this number only grows until a sender exists,
      // and it is the honest measure of how much a school has not been told.
      undelivered: Number(pending.count),
      note: 'Cleanup only — no notification is sent until the delivery channels are decided.',
    };
  }
}
