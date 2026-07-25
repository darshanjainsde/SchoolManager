import { Injectable, Logger } from '@nestjs/common';
import type { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import type { PrismaClient } from '@skoolos/db';
import { formatNotification } from './format';
import type { NotificationChannel, NotificationMessage } from './notification.types';

/**
 * LAZY-LOADED on purpose. `expo-server-sdk` v6 has a circular internal
 * require that the Vercel serverless bundler (ncc) mis-orders, throwing
 * `ReferenceError: Cannot access 'ExpoClient' before initialization` at
 * MODULE LOAD — which, because this file is imported at API bootstrap,
 * crashes the ENTIRE serverless function at cold start (every endpoint 500s).
 * The build succeeds; only the deployed function crashes — so it is invisible
 * to tsc/nest-build and only caught by actually invoking a deployed function.
 * Deferring the import + client construction to the first `send()` call moves
 * the circular init to well after the bundle has fully loaded, avoiding the
 * TDZ. Do NOT restore a top-level `import { Expo }` or a `new Expo()` field.
 */
let expoModule: typeof import('expo-server-sdk') | null = null;
let expoClient: Expo | null = null;
async function loadExpo(): Promise<{ ExpoCtor: typeof import('expo-server-sdk').Expo; expo: Expo }> {
  if (!expoModule) expoModule = await import('expo-server-sdk');
  if (!expoClient) expoClient = new expoModule.Expo();
  return { ExpoCtor: expoModule.Expo, expo: expoClient };
}

/**
 * Delivers a `NotificationMessage` to every registered device for a
 * recipient's email + school via Expo push.
 *
 * PRISMA CLIENT CHOICE: `EmailChannel` needs no DB lookup at all (SMTP
 * delivery is handed a resolved address directly). `PushChannel` does need
 * one (device tokens), and `withTenant(...)` is unavailable here — this
 * channel runs well after the caller's own tenant transaction has committed,
 * with no live RLS session to piggyback on. `getPlatformPrisma()` (BYPASSRLS,
 * same client `AuthService.login` uses to resolve a `User` before tenant
 * scope exists) is therefore the correct, deliberate choice here — wired up
 * in `notification.module.ts`'s factory, mirroring how every other service
 * in this codebase reaches Prisma via a direct function call rather than
 * Nest constructor DI (there is no injectable `PrismaClient` token).
 *
 * SCHOOL SCOPING IS LOAD-BEARING: because this lookup bypasses RLS, it MUST
 * filter by `schoolId` in addition to `email`. `User.email` is only unique
 * `@@unique([schoolId, email])` (packages/db/prisma/schema.prisma) — NOT
 * globally unique. Two different people at two different schools can share
 * an email string (plausible with generic addresses, and common across
 * seeded demo/QA tenants). Filtering by `email` alone would deliver School
 * A's push — an ABSENCE_NOTICE naming a specific child, or an ANNOUNCEMENT
 * body — to School B's devices for that address too. `NotificationService`
 * passes `schoolId` from the recipient it already resolved inside the
 * caller's `withTenant(schoolId, ...)` block (see recipients.ts /
 * notification.types.ts), so it is always available by the time a channel
 * sees it — this was a real cross-tenant PII leak until this filter was
 * added.
 */
@Injectable()
export class PushChannel implements NotificationChannel {
  readonly name = 'push';

  private readonly logger = new Logger(PushChannel.name);

  constructor(private readonly prisma: Pick<PrismaClient, 'pushToken'>) {}

  async send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean> {
    const rows = await this.prisma.pushToken.findMany({
      where: { schoolId, email: to },
      select: { token: true },
    });
    if (rows.length === 0) return false;

    // Lazy-loaded (see top-of-file note) — never touches expo-server-sdk at boot.
    const { ExpoCtor, expo } = await loadExpo();
    const tokens = rows.map((r) => r.token).filter((t) => ExpoCtor.isExpoPushToken(t));
    if (tokens.length === 0) return false;

    const { title, body } = formatNotification(message);
    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
    }));
    const chunks = expo.chunkPushNotifications(messages);

    const dead: string[] = [];
    let delivered = false;
    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await expo.sendPushNotificationsAsync(chunk);
      } catch (e) {
        this.logger.error(`Expo push chunk failed: ${(e as Error).message}`);
        continue;
      }
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'ok') {
          delivered = true;
        } else if (ticket.details?.error === 'DeviceNotRegistered') {
          dead.push(chunk[i].to as string);
        } else {
          this.logger.warn(`Expo push ticket error for ${to}: ${ticket.message}`);
        }
      });
    }

    if (dead.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    }

    return delivered;
  }
}
